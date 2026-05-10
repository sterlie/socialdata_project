(function () {
  "use strict";

  const metricsData = window.WEB_METRICS;
  if (!metricsData) {
    return;
  }

  const districtSelect = document.getElementById("explorer-district");
  const metricSelect = document.getElementById("explorer-metric");
  const startSelect = document.getElementById("explorer-start");
  const endSelect = document.getElementById("explorer-end");
  const svg = document.getElementById("explorer-chart");
  const summaryEl = document.getElementById("explorer-summary");
  const baselineNoteEl = document.getElementById("explorer-baseline-note");

  const cardJutland = document.getElementById("stat-jutland-share");
  const cardLocal = document.getElementById("stat-local-share");
  const cardCorr = document.getElementById("stat-correlation");

  const metricOrder = [
    "jutland_share_pct",
    "local_share_pct",
    "high_ed_share_pct",
    "jutland_residents",
    "local_residents",
    "total_residents",
  ];

  const years = metricsData.years.slice().sort(function (a, b) { return a - b; });
  const districts = metricsData.districts.slice().sort();

  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function createOption(value, label) {
    const opt = document.createElement("option");
    opt.value = String(value);
    opt.textContent = label;
    return opt;
  }

  function formatMetricValue(metric, value) {
    if (value == null || !Number.isFinite(value)) {
      return "n/a";
    }
    const meta = metricsData.metrics[metric] || {};
    const decimals = Number.isInteger(meta.decimals) ? meta.decimals : 2;
    if (meta.unit === "%") {
      return value.toFixed(decimals) + "%";
    }
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(value);
  }

  function metricHasCityBaseline(metric) {
    const cityYears = Object.keys(metricsData.city_year || {});
    if (!cityYears.length) {
      return false;
    }
    const sample = metricsData.city_year[cityYears[0]];
    return Object.prototype.hasOwnProperty.call(sample, metric);
  }

  function setHeadlineStats() {
    const cityYears = Object.keys(metricsData.city_year || {}).map(Number).sort(function (a, b) {
      return a - b;
    });
    if (!cityYears.length) {
      return;
    }

    const startYear = cityYears[0];
    const endYear = cityYears[cityYears.length - 1];
    const start = metricsData.city_year[String(startYear)];
    const end = metricsData.city_year[String(endYear)];

    cardJutland.textContent =
      formatMetricValue("jutland_share_pct", start.jutland_share_pct) +
      " -> " +
      formatMetricValue("jutland_share_pct", end.jutland_share_pct) +
      " (" + startYear + "-" + endYear + ")";

    cardLocal.textContent =
      formatMetricValue("local_share_pct", start.local_share_pct) +
      " -> " +
      formatMetricValue("local_share_pct", end.local_share_pct) +
      " (" + startYear + "-" + endYear + ")";

    const corrAll = metricsData.highlights && metricsData.highlights.corr_all_years;
    const corrLatest = metricsData.highlights && metricsData.highlights.corr_latest_year;
    const latestYear = metricsData.latest_year;
    cardCorr.textContent =
      "r=" + Number(corrAll).toFixed(2) + " (all years), r=" + Number(corrLatest).toFixed(2) + " (" + latestYear + ")";
  }

  function populateControls() {
    clearChildren(districtSelect);
    clearChildren(metricSelect);
    clearChildren(startSelect);
    clearChildren(endSelect);

    districts.forEach(function (district) {
      districtSelect.appendChild(createOption(district, district));
    });

    metricOrder.forEach(function (metricKey) {
      if (!metricsData.metrics[metricKey]) {
        return;
      }
      metricSelect.appendChild(createOption(metricKey, metricsData.metrics[metricKey].label));
    });

    years.forEach(function (year) {
      startSelect.appendChild(createOption(year, String(year)));
      endSelect.appendChild(createOption(year, String(year)));
    });

    const topList = (metricsData.highlights && metricsData.highlights.top_jutland_latest) || [];
    const defaultDistrict = topList.length ? topList[0].district : districts[0];

    districtSelect.value = defaultDistrict;
    metricSelect.value = "jutland_share_pct";
    startSelect.value = String(years[0]);
    endSelect.value = String(years[years.length - 1]);
  }

  function seriesForDistrict(district, metric, startYear, endYear) {
    const output = [];
    for (let y = startYear; y <= endYear; y += 1) {
      const rowByYear = metricsData.district_year[String(y)] || {};
      const row = rowByYear[district];
      if (!row) {
        continue;
      }
      const v = Number(row[metric]);
      if (Number.isFinite(v)) {
        output.push({ year: y, value: v });
      }
    }
    return output;
  }

  function seriesForCity(metric, startYear, endYear) {
    if (!metricHasCityBaseline(metric)) {
      return [];
    }
    const output = [];
    for (let y = startYear; y <= endYear; y += 1) {
      const row = metricsData.city_year[String(y)];
      if (!row) {
        continue;
      }
      const v = Number(row[metric]);
      if (Number.isFinite(v)) {
        output.push({ year: y, value: v });
      }
    }
    return output;
  }

  function buildPath(points, xScale, yScale) {
    return points
      .map(function (pt, idx) {
        const cmd = idx === 0 ? "M" : "L";
        return cmd + xScale(pt.year).toFixed(2) + " " + yScale(pt.value).toFixed(2);
      })
      .join(" ");
  }

  function addSvgElement(name, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.keys(attrs).forEach(function (k) {
      el.setAttribute(k, String(attrs[k]));
    });
    svg.appendChild(el);
    return el;
  }

  function render() {
    let startYear = Number(startSelect.value);
    let endYear = Number(endSelect.value);
    if (startYear > endYear) {
      const tmp = startYear;
      startYear = endYear;
      endYear = tmp;
      startSelect.value = String(startYear);
      endSelect.value = String(endYear);
    }

    const district = districtSelect.value;
    const metric = metricSelect.value;
    const meta = metricsData.metrics[metric] || { label: metric };

    const districtSeries = seriesForDistrict(district, metric, startYear, endYear);
    const citySeries = seriesForCity(metric, startYear, endYear);

    clearChildren(svg);

    if (!districtSeries.length) {
      addSvgElement("text", {
        x: 40,
        y: 50,
        fill: "#7a5a4d",
        "font-size": "14",
      }).textContent = "No district data for this selection.";
      summaryEl.textContent = "No summary available for this selection.";
      baselineNoteEl.textContent = "";
      return;
    }

    const margin = { top: 24, right: 24, bottom: 40, left: 64 };
    const width = 900;
    const height = 340;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const allVals = districtSeries.map(function (d) { return d.value; }).concat(
      citySeries.map(function (d) { return d.value; })
    );
    let yMin = Math.min.apply(null, allVals);
    let yMax = Math.max.apply(null, allVals);
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;

    const xScale = function (year) {
      return margin.left + ((year - startYear) / (endYear - startYear || 1)) * innerW;
    };
    const yScale = function (val) {
      return margin.top + ((yMax - val) / (yMax - yMin || 1)) * innerH;
    };

    addSvgElement("rect", {
      x: margin.left,
      y: margin.top,
      width: innerW,
      height: innerH,
      fill: "#fffefb",
      stroke: "#e5d0c0",
    });

    const yTicks = 5;
    for (let i = 0; i <= yTicks; i += 1) {
      const ratio = i / yTicks;
      const yVal = yMax - ratio * (yMax - yMin);
      const y = yScale(yVal);
      addSvgElement("line", {
        x1: margin.left,
        y1: y,
        x2: margin.left + innerW,
        y2: y,
        stroke: "#eee0d5",
        "stroke-width": 1,
      });
      addSvgElement("text", {
        x: margin.left - 8,
        y: y + 4,
        fill: "#6f5a4d",
        "font-size": 11,
        "text-anchor": "end",
      }).textContent = formatMetricValue(metric, yVal);
    }

    const xTicks = Math.min(8, Math.max(2, endYear - startYear));
    for (let i = 0; i <= xTicks; i += 1) {
      const year = Math.round(startYear + (i / xTicks) * (endYear - startYear));
      const x = xScale(year);
      addSvgElement("line", {
        x1: x,
        y1: margin.top,
        x2: x,
        y2: margin.top + innerH,
        stroke: "#f3e8de",
        "stroke-width": 1,
      });
      addSvgElement("text", {
        x: x,
        y: margin.top + innerH + 18,
        fill: "#6f5a4d",
        "font-size": 11,
        "text-anchor": "middle",
      }).textContent = String(year);
    }

    if (citySeries.length) {
      addSvgElement("path", {
        d: buildPath(citySeries, xScale, yScale),
        fill: "none",
        stroke: "#b45309",
        "stroke-width": 2,
        "stroke-dasharray": "6 5",
        opacity: 0.9,
      });
    }

    addSvgElement("path", {
      d: buildPath(districtSeries, xScale, yScale),
      fill: "none",
      stroke: "#0f766e",
      "stroke-width": 3,
    });

    districtSeries.forEach(function (pt) {
      addSvgElement("circle", {
        cx: xScale(pt.year),
        cy: yScale(pt.value),
        r: 2.8,
        fill: "#0f766e",
      });
    });

    addSvgElement("text", {
      x: margin.left,
      y: 16,
      fill: "#2f1e16",
      "font-size": 14,
      "font-weight": 700,
    }).textContent = district + " - " + meta.label;

    addSvgElement("line", {
      x1: margin.left,
      y1: height - 12,
      x2: margin.left + 24,
      y2: height - 12,
      stroke: "#0f766e",
      "stroke-width": 3,
    });
    addSvgElement("text", {
      x: margin.left + 30,
      y: height - 8,
      fill: "#2f1e16",
      "font-size": 12,
    }).textContent = "District";

    addSvgElement("line", {
      x1: margin.left + 108,
      y1: height - 12,
      x2: margin.left + 132,
      y2: height - 12,
      stroke: "#b45309",
      "stroke-width": 2,
      "stroke-dasharray": "6 5",
    });
    addSvgElement("text", {
      x: margin.left + 138,
      y: height - 8,
      fill: "#2f1e16",
      "font-size": 12,
    }).textContent = "City baseline";

    const startValue = districtSeries[0].value;
    const endValue = districtSeries[districtSeries.length - 1].value;
    const delta = endValue - startValue;
    const deltaSign = delta >= 0 ? "+" : "";

    summaryEl.textContent =
      district +
      " changed from " +
      formatMetricValue(metric, startValue) +
      " to " +
      formatMetricValue(metric, endValue) +
      " between " +
      startYear +
      " and " +
      endYear +
      " (" +
      deltaSign +
      formatMetricValue(metric, delta) +
      ").";

    if (citySeries.length) {
      baselineNoteEl.textContent = "City baseline is shown for the same metric and year window.";
    } else {
      baselineNoteEl.textContent = "City baseline is unavailable for this metric in web_metrics city_year data.";
    }
  }

  populateControls();
  setHeadlineStats();
  render();

  [districtSelect, metricSelect, startSelect, endSelect].forEach(function (el) {
    el.addEventListener("change", render);
  });
})();
