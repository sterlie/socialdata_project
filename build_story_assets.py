from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
PLOTS_DIR = ROOT / "plots"
PLOTS_DIR.mkdir(exist_ok=True)


def load_residents(path: Path) -> tuple[pd.DataFrame, list[int]]:
    raw = pd.read_excel(path, sheet_name=0, header=None)

    year_count_by_row = raw.apply(
        lambda r: pd.to_numeric(r.iloc[4:], errors="coerce").between(1900, 2100).sum(),
        axis=1,
    )
    year_row_idx = int(year_count_by_row.idxmax())
    years = [
        int(v)
        for v in pd.to_numeric(raw.iloc[year_row_idx, 4:], errors="coerce").dropna().tolist()
    ]

    cols = ["age_group", "sex", "neighborhood_raw", "birth_region"] + years
    df = raw.iloc[year_row_idx + 1 :, : len(cols)].copy()
    df.columns = cols

    for c in ["age_group", "sex", "neighborhood_raw", "birth_region"]:
        df[c] = df[c].ffill()

    df = df[df["age_group"] == "Alder i alt"].copy()

    for y in years:
        df[y] = pd.to_numeric(df[y], errors="coerce").fillna(0)

    name_map = {"Vesterbro/Kongens Enghave": "Vesterbro-Kongens Enghave"}
    df["district"] = (
        df["neighborhood_raw"].astype(str).str.replace("Bydel - ", "", regex=False).replace(name_map)
    )

    return df, years


def reshape_residents(df: pd.DataFrame, years: list[int]) -> pd.DataFrame:
    long = df.melt(
        id_vars=["district", "birth_region", "sex"],
        value_vars=years,
        var_name="year",
        value_name="count",
    )
    long["year"] = long["year"].astype(int)
    long["count"] = pd.to_numeric(long["count"], errors="coerce").fillna(0)

    # Sum over sex for each district-region-year
    long = (
        long.groupby(["district", "birth_region", "year"], as_index=False)["count"]
        .sum()
        .sort_values(["district", "birth_region", "year"])
    )
    return long


def load_education(path: Path) -> pd.DataFrame:
    ed = pd.read_csv(path)
    ed["year"] = pd.to_numeric(ed["year"], errors="coerce")
    ed["value"] = pd.to_numeric(ed["value"], errors="coerce")

    ed = ed[
        (ed["age_group"] == "Age total")
        & (ed["sex"] == "Sex total")
        & (ed["area"].str.startswith("District - ", na=False))
    ].copy()

    ed["district"] = (
        ed["area"]
        .str.replace("District - ", "", regex=False)
        .str.replace("Vesterbro/Kongens Enghave", "Vesterbro-Kongens Enghave", regex=False)
    )

    return ed


def compute_metrics(res_long: pd.DataFrame, ed: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    # Residents-based shares
    res_total = (
        res_long.groupby(["district", "year"], as_index=False)["count"].sum().rename(columns={"count": "total_residents"})
    )

    jutland_regions = ["Nordjylland", "Vestjylland", "Østjylland", "Sydjylland"]
    local_region = "Københavns Kommune"

    jut = (
        res_long[res_long["birth_region"].isin(jutland_regions)]
        .groupby(["district", "year"], as_index=False)["count"]
        .sum()
        .rename(columns={"count": "jutland_residents"})
    )

    local = (
        res_long[res_long["birth_region"] == local_region]
        .groupby(["district", "year"], as_index=False)["count"]
        .sum()
        .rename(columns={"count": "local_residents"})
    )

    residents_panel = res_total.merge(jut, on=["district", "year"], how="left").merge(local, on=["district", "year"], how="left")
    residents_panel[["jutland_residents", "local_residents"]] = residents_panel[
        ["jutland_residents", "local_residents"]
    ].fillna(0)
    residents_panel["jutland_share_pct"] = 100 * residents_panel["jutland_residents"] / residents_panel["total_residents"]
    residents_panel["local_share_pct"] = 100 * residents_panel["local_residents"] / residents_panel["total_residents"]

    # Education-based high education share
    high_ed_levels = {
        "Vocational bachelors educations and bachelors programs",
        "Masters and PhD programs",
    }

    total_ed = (
        ed[ed["education_level"] == "Highest education completed total"]
        .groupby(["district", "year"], as_index=False)["value"]
        .sum()
        .rename(columns={"value": "edu_total"})
    )

    high_ed = (
        ed[ed["education_level"].isin(high_ed_levels)]
        .groupby(["district", "year"], as_index=False)["value"]
        .sum()
        .rename(columns={"value": "edu_high"})
    )

    edu_panel = total_ed.merge(high_ed, on=["district", "year"], how="left")
    edu_panel["edu_high"] = edu_panel["edu_high"].fillna(0)
    edu_panel["high_ed_share_pct"] = 100 * edu_panel["edu_high"] / edu_panel["edu_total"]

    # Keep only geographic districts
    geo_mask = ~residents_panel["district"].str.contains("Uden for inddeling", case=False, na=False)
    residents_panel = residents_panel[geo_mask].copy()

    combined = residents_panel.merge(edu_panel, on=["district", "year"], how="inner")
    combined = combined.replace([np.inf, -np.inf], np.nan).dropna(
        subset=["jutland_share_pct", "local_share_pct", "high_ed_share_pct"]
    )

    # Key summary numbers
    latest_res_year = int(residents_panel["year"].max())
    latest_edu_year = int(edu_panel["year"].max())
    latest_join_year = int(combined["year"].max())

    city_ts = (
        residents_panel.groupby("year", as_index=False)[
            ["jutland_residents", "local_residents", "total_residents"]
        ]
        .sum()
        .sort_values("year")
    )
    city_ts["jutland_share_pct"] = 100 * city_ts["jutland_residents"] / city_ts["total_residents"]
    city_ts["local_share_pct"] = 100 * city_ts["local_residents"] / city_ts["total_residents"]

    latest_district = (
        residents_panel[residents_panel["year"] == latest_res_year]
        [["district", "jutland_share_pct", "local_share_pct", "jutland_residents"]]
        .sort_values("jutland_share_pct", ascending=False)
    )

    corr_all = float(combined["jutland_share_pct"].corr(combined["high_ed_share_pct"]))
    corr_latest = float(
        combined[combined["year"] == latest_join_year]["jutland_share_pct"].corr(
            combined[combined["year"] == latest_join_year]["high_ed_share_pct"]
        )
    )

    changes = combined[combined["year"].isin([1985, latest_join_year])].copy()
    changes = changes.pivot_table(
        index="district",
        columns="year",
        values=["jutland_share_pct", "high_ed_share_pct"],
    )
    changes.columns = [f"{a}_{b}" for a, b in changes.columns]
    changes = changes.dropna()
    changes["jutland_share_change"] = changes[f"jutland_share_pct_{latest_join_year}"] - changes[
        "jutland_share_pct_1985"
    ]
    changes["high_ed_share_change"] = changes[f"high_ed_share_pct_{latest_join_year}"] - changes[
        "high_ed_share_pct_1985"
    ]
    changes = changes.sort_values("jutland_share_change", ascending=False)

    summary = {
        "latest_res_year": latest_res_year,
        "latest_edu_year": latest_edu_year,
        "latest_join_year": latest_join_year,
        "corr_all_years": corr_all,
        "corr_latest_year": corr_latest,
        "city_jutland_share_start": float(city_ts.iloc[0]["jutland_share_pct"]),
        "city_jutland_share_end": float(city_ts.iloc[-1]["jutland_share_pct"]),
        "city_local_share_start": float(city_ts.iloc[0]["local_share_pct"]),
        "city_local_share_end": float(city_ts.iloc[-1]["local_share_pct"]),
        "top_jutland_district_latest": latest_district.head(3).to_dict(orient="records"),
        "bottom_jutland_district_latest": latest_district.tail(3).to_dict(orient="records"),
        "largest_jutland_share_increase": changes.head(3).reset_index().to_dict(orient="records"),
    }

    return combined, city_ts, summary


def make_plots(combined: pd.DataFrame, city_ts: pd.DataFrame, summary: dict) -> None:
    # 1) Citywide share trends
    fig, ax = plt.subplots(figsize=(10, 5.2), dpi=140)
    ax.plot(city_ts["year"], city_ts["jutland_share_pct"], label="Jutland-born share", lw=2.6, color="#0f766e")
    ax.plot(city_ts["year"], city_ts["local_share_pct"], label="Copenhagen Kommune-born share", lw=2.6, color="#b91c1c")
    ax.set_title("Citywide Origin Shares Over Time")
    ax.set_xlabel("Year")
    ax.set_ylabel("Share of residents in district dataset (%)")
    ax.grid(alpha=0.25)
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "citywide_origin_shares.png")
    plt.close(fig)

    # 2) Latest year district ranking
    latest = combined[combined["year"] == summary["latest_join_year"]].copy()
    latest = latest[["district", "jutland_share_pct"]].drop_duplicates().sort_values("jutland_share_pct")
    fig, ax = plt.subplots(figsize=(9.8, 5.8), dpi=140)
    ax.barh(latest["district"], latest["jutland_share_pct"], color="#0ea5e9")
    ax.set_title(f"Jutland-born Share by District ({summary['latest_join_year']})")
    ax.set_xlabel("Jutland-born share (%)")
    ax.grid(axis="x", alpha=0.25)
    for y, v in enumerate(latest["jutland_share_pct"]):
        ax.text(v + 0.05, y, f"{v:.1f}%", va="center", fontsize=8)
    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "district_jutland_share_latest.png")
    plt.close(fig)

    # 3) Relationship between district education profile and Jutland share
    fig, ax = plt.subplots(figsize=(7.8, 6.0), dpi=140)
    sc = ax.scatter(
        combined["high_ed_share_pct"],
        combined["jutland_share_pct"],
        c=combined["year"],
        cmap="viridis",
        alpha=0.35,
        s=28,
        edgecolors="none",
    )

    x = combined["high_ed_share_pct"].values
    y = combined["jutland_share_pct"].values
    coeff = np.polyfit(x, y, deg=1)
    xline = np.linspace(float(np.nanmin(x)), float(np.nanmax(x)), 200)
    yline = coeff[0] * xline + coeff[1]
    ax.plot(xline, yline, color="#f97316", lw=2.2, label=f"Linear fit (slope={coeff[0]:.2f})")

    ax.set_title("District-Years: Higher Education vs Jutland Presence")
    ax.set_xlabel("High education share (%)")
    ax.set_ylabel("Jutland-born share (%)")
    ax.grid(alpha=0.25)
    cbar = fig.colorbar(sc, ax=ax)
    cbar.set_label("Year")
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "education_vs_jutland_scatter.png")
    plt.close(fig)

    # 4) High-change districts over time
    latest_year = summary["latest_join_year"]
    base = combined[combined["year"] == 1985][["district", "jutland_share_pct"]].rename(
        columns={"jutland_share_pct": "j1985"}
    )
    end = combined[combined["year"] == latest_year][["district", "jutland_share_pct"]].rename(
        columns={"jutland_share_pct": "j_end"}
    )
    dif = base.merge(end, on="district", how="inner")
    dif["diff"] = dif["j_end"] - dif["j1985"]
    top3 = dif.sort_values("diff", ascending=False).head(3)["district"].tolist()

    pick = combined[combined["district"].isin(top3)].copy()

    fig, axes = plt.subplots(1, 2, figsize=(12.8, 5.4), dpi=140, sharex=True)
    for d in top3:
        ddf = pick[pick["district"] == d].sort_values("year")
        axes[0].plot(ddf["year"], ddf["jutland_share_pct"], label=d, lw=2.1)
        axes[1].plot(ddf["year"], ddf["high_ed_share_pct"], label=d, lw=2.1)

    axes[0].set_title("Jutland-born share over time")
    axes[1].set_title("High-education share over time")
    for ax in axes:
        ax.grid(alpha=0.25)
        ax.set_xlabel("Year")
    axes[0].set_ylabel("Share (%)")
    axes[1].set_ylabel("Share (%)")
    axes[1].legend(frameon=False, loc="best", fontsize=9)
    fig.suptitle("Districts with the strongest rise in Jutland presence")
    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "top_growth_districts_trends.png")
    plt.close(fig)


def build_web_metrics(combined: pd.DataFrame, city_ts: pd.DataFrame, summary: dict) -> dict:
    metric_keys = [
        "jutland_share_pct",
        "local_share_pct",
        "high_ed_share_pct",
        "jutland_residents",
        "local_residents",
        "total_residents",
    ]

    metrics_meta = {
        "jutland_share_pct": {"label": "Jutland-born share", "unit": "%", "decimals": 2},
        "local_share_pct": {"label": "København-born share", "unit": "%", "decimals": 2},
        "high_ed_share_pct": {"label": "High-education share", "unit": "%", "decimals": 2},
        "jutland_residents": {"label": "Jutland-born residents", "unit": "count", "decimals": 0},
        "local_residents": {"label": "København-born residents", "unit": "count", "decimals": 0},
        "total_residents": {"label": "Total residents", "unit": "count", "decimals": 0},
    }

    years = sorted(int(y) for y in combined["year"].unique())
    districts = sorted(combined["district"].unique().tolist())

    district_year = {}
    for y in years:
        ydf = combined[combined["year"] == y]
        district_year[str(y)] = {}
        for _, row in ydf.iterrows():
            district_year[str(y)][row["district"]] = {
                k: (float(row[k]) if pd.notnull(row[k]) else None) for k in metric_keys
            }

    city_metric_cols = ["year", "jutland_share_pct", "local_share_pct", "jutland_residents", "local_residents", "total_residents"]
    city_year = {}
    for _, row in city_ts[city_metric_cols].iterrows():
        city_year[str(int(row["year"]))] = {
            "jutland_share_pct": float(row["jutland_share_pct"]),
            "local_share_pct": float(row["local_share_pct"]),
            "jutland_residents": float(row["jutland_residents"]),
            "local_residents": float(row["local_residents"]),
            "total_residents": float(row["total_residents"]),
        }

    return {
        "latest_year": int(summary["latest_join_year"]),
        "years": years,
        "districts": districts,
        "metrics": metrics_meta,
        "district_year": district_year,
        "city_year": city_year,
        "highlights": {
            "corr_all_years": float(summary["corr_all_years"]),
            "corr_latest_year": float(summary["corr_latest_year"]),
            "top_jutland_latest": summary["top_jutland_district_latest"],
        },
    }


def main() -> None:
    residents_raw, years = load_residents(ROOT / "residents.xlsx")
    residents_long = reshape_residents(residents_raw, years)
    education = load_education(ROOT / "education_attainment_dataset.csv")

    combined, city_ts, summary = compute_metrics(residents_long, education)

    make_plots(combined, city_ts, summary)

    summary["dataset_overview"] = {
        "residents_rows_after_cleaning": int(len(residents_raw)),
        "residents_year_min": int(min(years)),
        "residents_year_max": int(max(years)),
        "residents_regions": int(residents_raw["birth_region"].nunique()),
        "education_rows": int(len(education)),
        "education_year_min": int(education["year"].min()),
        "education_year_max": int(education["year"].max()),
        "education_districts": int(education["district"].nunique()),
        "combined_rows": int(len(combined)),
    }

    (ROOT / "analysis_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    # Export merged panel for transparency and notebook use
    combined.sort_values(["district", "year"]).to_csv(ROOT / "district_year_panel.csv", index=False)
    web_metrics = build_web_metrics(combined, city_ts, summary)
    (ROOT / "web_metrics.json").write_text(json.dumps(web_metrics, ensure_ascii=False), encoding="utf-8")
    (ROOT / "web_metrics.js").write_text(
        "window.WEB_METRICS = " + json.dumps(web_metrics, ensure_ascii=False) + ";",
        encoding="utf-8",
    )
    bydel_geo = json.loads((ROOT / "bydel.csv").read_text(encoding="utf-8"))
    (ROOT / "bydel_geo.js").write_text(
        "window.BYDEL_GEOJSON = " + json.dumps(bydel_geo, ensure_ascii=False) + ";",
        encoding="utf-8",
    )

    print("Wrote:")
    print("- plots/citywide_origin_shares.png")
    print("- plots/district_jutland_share_latest.png")
    print("- plots/education_vs_jutland_scatter.png")
    print("- plots/top_growth_districts_trends.png")
    print("- district_year_panel.csv")
    print("- analysis_summary.json")
    print("- web_metrics.json")
    print("- web_metrics.js")
    print("- bydel_geo.js")


if __name__ == "__main__":
    main()
