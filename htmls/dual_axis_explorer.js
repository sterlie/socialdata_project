(function () {
  "use strict";

  var data = window.DUAL_AXIS_DATA;
  if (!data) { return; }

  var districtSelect = document.getElementById("dual-district");
  var startSelect    = document.getElementById("dual-start");
  var endSelect      = document.getElementById("dual-end");
  var svg            = document.getElementById("dual-chart");
  var summaryEl      = document.getElementById("dual-summary");

  if (!districtSelect || !startSelect || !endSelect || !svg || !summaryEl) { return; }

  // ── Populate district dropdown ───────────────────────────────
  var districts = Object.keys(data).sort();
  districts.forEach(function (d) {
    var opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    districtSelect.appendChild(opt);
  });
  if (data["Nørrebro"]) { districtSelect.value = "Nørrebro"; }

  // ── Populate year dropdowns from available years ─────────────
  var allYears = data[districts[0]].map(function (d) { return d.year; }).sort(function (a, b) { return a - b; });
  allYears.forEach(function (y) {
    var o1 = document.createElement("option");
    o1.value = y; o1.textContent = y;
    startSelect.appendChild(o1);
    var o2 = document.createElement("option");
    o2.value = y; o2.textContent = y;
    endSelect.appendChild(o2);
  });
  startSelect.value = String(allYears[0]);
  endSelect.value   = String(allYears[allYears.length - 1]);

  // ── Helpers ──────────────────────────────────────────────────
  function clearChildren(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  function addEl(tag, attrs, text) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
    if (text != null) { el.textContent = text; }
    svg.appendChild(el);
    return el;
  }

  function buildPath(points, xFn, yFn) {
    return points.map(function (pt, i) {
      return (i === 0 ? "M" : "L") + xFn(pt).toFixed(2) + " " + yFn(pt).toFixed(2);
    }).join(" ");
  }

  function axisRange(vals) {
    var mn = Math.min.apply(null, vals);
    var mx = Math.max.apply(null, vals);
    var pad = (mx - mn) * 0.12;
    return [mn - pad, mx + pad];
  }

  // ── Render ───────────────────────────────────────────────────
  function render() {
    clearChildren(svg);

    var district = districtSelect.value;
    var startYear = Number(startSelect.value);
    var endYear   = Number(endSelect.value);

    // Swap silently if inverted
    if (startYear > endYear) {
      var tmp = startYear; startYear = endYear; endYear = tmp;
      startSelect.value = String(startYear);
      endSelect.value   = String(endYear);
    }

    var fullSeries = data[district];
    if (!fullSeries || !fullSeries.length) { return; }

    // Filter to selected year range
    var series = fullSeries.filter(function (d) {
      return d.year >= startYear && d.year <= endYear;
    });
    if (series.length < 2) {
      summaryEl.textContent = "Select a wider year range to display the chart.";
      return;
    }

    var W = 900, H = 340;
    var margin = { top: 28, right: 72, bottom: 44, left: 68 };
    var iW = W - margin.left - margin.right;
    var iH = H - margin.top - margin.bottom;

    var years   = series.map(function (d) { return d.year; });
    var eduVals = series.map(function (d) { return d.edu; });
    var jutVals = series.map(function (d) { return d.jut; });
    var yearMin = years[0], yearMax = years[years.length - 1];

    var eduRange = axisRange(eduVals);
    var jutRange = axisRange(jutVals);

    function xScale(year) {
      return margin.left + ((year - yearMin) / (Math.max(yearMax - yearMin, 1))) * iW;
    }
    function yEdu(val) {
      return margin.top + ((eduRange[1] - val) / (eduRange[1] - eduRange[0])) * iH;
    }
    function yJut(val) {
      return margin.top + ((jutRange[1] - val) / (jutRange[1] - jutRange[0])) * iH;
    }

    // Background
    addEl("rect", { x: margin.left, y: margin.top, width: iW, height: iH,
                    fill: "#fffefb", stroke: "#e5d0c0" });

    // Grid lines + left y-axis ticks (education)
    var TICKS = 5;
    for (var i = 0; i <= TICKS; i++) {
      var ratio  = i / TICKS;
      var eduVal = eduRange[1] - ratio * (eduRange[1] - eduRange[0]);
      var yy     = yEdu(eduVal);
      addEl("line", { x1: margin.left, y1: yy, x2: margin.left + iW, y2: yy,
                      stroke: "#eee0d5", "stroke-width": 1 });
      addEl("text", { x: margin.left - 8, y: yy + 4, fill: "#6f5a4d",
                      "font-size": 11, "text-anchor": "end" },
            eduVal.toFixed(1) + "%");
    }

    // Right y-axis ticks (jutland)
    for (var j = 0; j <= TICKS; j++) {
      var ratioJ = j / TICKS;
      var jutVal = jutRange[1] - ratioJ * (jutRange[1] - jutRange[0]);
      var yyJ    = yJut(jutVal);
      addEl("text", { x: margin.left + iW + 8, y: yyJ + 4, fill: "#6f5a4d",
                      "font-size": 11, "text-anchor": "start" },
            jutVal.toFixed(1) + "%");
    }

    // X-axis ticks
    var xTicks = Math.min(8, yearMax - yearMin);
    for (var k = 0; k <= xTicks; k++) {
      var yr = Math.round(yearMin + (k / xTicks) * (yearMax - yearMin));
      var xx = xScale(yr);
      addEl("line", { x1: xx, y1: margin.top, x2: xx, y2: margin.top + iH,
                      stroke: "#f3e8de", "stroke-width": 1 });
      addEl("text", { x: xx, y: margin.top + iH + 16, fill: "#6f5a4d",
                      "font-size": 11, "text-anchor": "middle" }, String(yr));
    }

    // Education line — solid teal
    addEl("path", {
      d: buildPath(series,
        function (d) { return xScale(d.year); },
        function (d) { return yEdu(d.edu); }),
      fill: "none", stroke: "#0f766e", "stroke-width": 3
    });
    series.forEach(function (pt) {
      addEl("circle", { cx: xScale(pt.year), cy: yEdu(pt.edu),
                        r: 2.8, fill: "#0f766e" });
    });

    // Jutland line — dashed orange
    addEl("path", {
      d: buildPath(series,
        function (d) { return xScale(d.year); },
        function (d) { return yJut(d.jut); }),
      fill: "none", stroke: "#b45309", "stroke-width": 2.5, "stroke-dasharray": "7 5"
    });
    series.forEach(function (pt) {
      addEl("circle", { cx: xScale(pt.year), cy: yJut(pt.jut),
                        r: 2.2, fill: "#b45309", opacity: 0.85 });
    });

    // Chart title
    addEl("text", { x: margin.left, y: 18, fill: "#2f1e16",
                    "font-size": 14, "font-weight": 700 },
          district + " — Higher education share vs Jutland-born share");

    // Left axis label
    addEl("text", {
      x: -(margin.top + iH / 2), y: 14,
      fill: "#0f766e", "font-size": 11, "font-weight": 600,
      "text-anchor": "middle", transform: "rotate(-90)"
    }, "Higher education share (%)");

    // Right axis label
    addEl("text", {
      x: margin.top + iH / 2, y: -(W - 14),
      fill: "#b45309", "font-size": 11, "font-weight": 600,
      "text-anchor": "middle", transform: "rotate(90)"
    }, "Jutland-born share (%)");

    // Legend
    var lx = margin.left, ly = H - 10;
    addEl("line", { x1: lx, y1: ly, x2: lx + 24, y2: ly,
                    stroke: "#0f766e", "stroke-width": 3 });
    addEl("text", { x: lx + 30, y: ly + 4, fill: "#2f1e16", "font-size": 12 },
          "Higher education share");
    addEl("line", { x1: lx + 196, y1: ly, x2: lx + 220, y2: ly,
                    stroke: "#b45309", "stroke-width": 2.5, "stroke-dasharray": "7 5" });
    addEl("text", { x: lx + 226, y: ly + 4, fill: "#2f1e16", "font-size": 12 },
          "Jutland-born share");

    // Summary text
    var firstEdu = eduVals[0], lastEdu = eduVals[eduVals.length - 1];
    var firstJut = jutVals[0], lastJut = jutVals[jutVals.length - 1];
    var dEdu = (lastEdu - firstEdu).toFixed(1);
    var dJut = (lastJut - firstJut >= 0 ? "+" : "") + (lastJut - firstJut).toFixed(1);
    summaryEl.textContent =
      district + ": higher education share rose from " +
      firstEdu.toFixed(1) + "% to " + lastEdu.toFixed(1) + "% (+" + dEdu + " pp). " +
      "Jutland-born share changed from " +
      firstJut.toFixed(1) + "% to " + lastJut.toFixed(1) + "% (" + dJut + " pp) " +
      "between " + yearMin + " and " + yearMax + ".";
  }

  render();
  [districtSelect, startSelect, endSelect].forEach(function (el) {
    el.addEventListener("change", render);
  });

})();
