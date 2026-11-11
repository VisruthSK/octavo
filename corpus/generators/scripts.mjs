export const bootstrapJs = () => `/*! Bootstrap v5.3.3 (https://getbootstrap.com/) | MIT License | https://github.com/twbs/bootstrap */
(function () {
  "use strict";
  var VERSION = "5.3.3";
  var data = function (element, name) {
    return element.getAttribute("data-bs-" + name) || "";
  };
  var each = function (selector, callback) {
    var nodes = document.querySelectorAll(selector);
    for (var index = 0; index < nodes.length; index += 1) callback(nodes[index]);
  };
  var collapse = function (trigger) {
    var selector = data(trigger, "target");
    var target = selector ? document.querySelector(selector) : null;
    if (!target) return;
    var shown = target.classList.contains("show");
    if (shown) target.classList.remove("show");
    else target.classList.add("show");
    target.setAttribute("aria-hidden", shown ? "true" : "false");
    trigger.setAttribute("aria-expanded", shown ? "false" : "true");
  };
  var tab = function (trigger) {
    var selector = data(trigger, "target");
    var pane = selector ? document.querySelector(selector) : null;
    if (!pane) return;
    var group = trigger.closest(".nav-tabs, .nav-pills");
    if (group) {
      each(group.querySelectorAll("[data-bs-toggle]"), function (other) {
        other.classList.remove("active");
        other.setAttribute("aria-selected", "false");
      });
    }
    trigger.classList.add("active");
    trigger.setAttribute("aria-selected", "true");
    each(pane.parentElement.children, function (sibling) {
      sibling.classList.remove("active");
      sibling.classList.remove("show");
    });
    pane.classList.add("active");
    pane.classList.add("show");
  };
  var dismiss = function (trigger) {
    var selector = data(trigger, "target");
    var target = selector ? document.querySelector(selector) : null;
    if (target) {
      target.classList.remove("show");
      target.setAttribute("aria-hidden", "true");
    }
  };
  var scroll = function (trigger) {
    var selector = data(trigger, "target");
    var target = selector ? document.querySelector(selector) : null;
    if (target) target.scrollIntoView({ block: "start" });
  };
  each("[data-bs-toggle]", function (element) {
    element.addEventListener("click", function (event) {
      event.preventDefault();
      var kind = data(element, "toggle");
      if (kind === "collapse") collapse(element);
      else if (kind === "tab" || kind === "pill") tab(element);
      else if (kind === "modal") dismiss(element);
      else if (kind === "scroll") scroll(element);
    });
  });
  var root = document.documentElement;
  root.setAttribute("data-bs-version", VERSION);
  window.bootstrap = {
    version: VERSION,
    Collapse: { toggle: collapse },
    Tab: { show: tab },
    Modal: { hide: dismiss },
    Scroll: { to: scroll },
    Tooltip: function (element) {
      element.setAttribute("data-bs-toggle", "tooltip");
      return this;
    }
  };
})();
`;

export const popperJs = () => `/*! @popperjs/core v2.11.8 | MIT License */
(function () {
  "use strict";
  var apply = function (reference, popper) {
    var box = reference.getBoundingClientRect();
    popper.style.position = "absolute";
    popper.style.left = Math.round(box.left + box.width / 2) + "px";
    popper.style.top = Math.round(box.bottom) + "px";
    popper.style.zIndex = "1080";
  };
  var createPopper = function (reference, popper) {
    apply(reference, popper);
    return {
      update: function () {
        apply(reference, popper);
      },
      destroy: function () {
        popper.remove();
      }
    };
  };
  window.Popper = { createPopper: createPopper };
})();
`;

export const clipboardJs = () => `/*! clipboard.js v2.0.11 | MIT License */
(function () {
  "use strict";
  var ClipboardJS = function (element, options) {
    this.element = element;
    this.options = options || {};
    var self = this;
    element.addEventListener("click", function (event) {
      event.preventDefault();
      var text = self.options.text ? self.options.text() : element.getAttribute("data-clipboard-text") || "";
      element.setAttribute("data-copied", "true");
      element.setAttribute("title", "Copied " + text.length + " characters");
      if (self.options.onCopy) self.options.onCopy(text);
    });
  };
  ClipboardJS.prototype.destroy = function () {
    this.element.removeAttribute("data-copied");
  };
  window.ClipboardJS = ClipboardJS;
})();
`;

export const anchorJs = () => `/*! AnchorJS - v4.6.2 - AnchorJS is a small JS library for adding anchor links to headings */
(function () {
  "use strict";
  var add = function () {
    var headings = document.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]");
    for (var index = 0; index < headings.length; index += 1) {
      var heading = headings[index];
      if (heading.querySelector(".anchorjs-link")) continue;
      var link = document.createElement("a");
      link.className = "anchorjs-link";
      link.href = "#" + heading.id;
      link.textContent = "§";
      link.setAttribute("aria-hidden", "true");
      heading.appendChild(link);
    }
  };
  window.AnchorJS = { init: add, add: add, remove: function () {} };
  if (document.readyState !== "loading") add();
  else document.addEventListener("DOMContentLoaded", add);
})();
`;

export const tippyJs = () => `/*! tippy.js v6.3.7 | MIT License | powered by Popper, uses require("@popperjs/core") */
(function () {
  "use strict";
  var tooltip = null;
  var hide = function () {
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  };
  var show = function (reference, content) {
    hide();
    tooltip = document.createElement("div");
    tooltip.className = "tippy-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = content;
    document.body.appendChild(tooltip);
    if (window.Popper && window.Popper.createPopper) window.Popper.createPopper(reference, tooltip);
    return tooltip;
  };
  var tippy = function (reference, options) {
    var settings = options || {};
    var content = settings.content || reference.getAttribute("data-footnote") || "";
    reference.addEventListener("mouseenter", function () {
      show(reference, content);
    });
    reference.addEventListener("mouseleave", hide);
    reference.addEventListener("focus", function () {
      show(reference, content);
    });
    reference.addEventListener("blur", hide);
    return { destroy: hide };
  };
  window.tippy = tippy;
})();
`;

export const jqueryJs = () => `/*! jQuery v3.7.1 | https://jquery.com/ | MIT License */
(function (global) {
  "use strict";
  var readyCallbacks = [];
  var ready = function () {
    for (var index = 0; index < readyCallbacks.length; index += 1) readyCallbacks[index]();
  };
  var api = function (selector) {
    return {
      ready: function (callback) {
        if (document.readyState !== "loading") callback();
        else readyCallbacks.push(callback);
        return this;
      },
      on: function (event, handler) {
        var nodes = typeof selector === "string" ? document.querySelectorAll(selector) : [selector];
        for (var index = 0; index < nodes.length; index += 1) {
          nodes[index].addEventListener(event.split(" ")[0], handler);
        }
        return this;
      },
      each: function (callback) {
        var nodes = typeof selector === "string" ? document.querySelectorAll(selector) : [selector];
        for (var index = 0; index < nodes.length; index += 1) callback(index, nodes[index]);
        return this;
      },
      addClass: function (name) {
        var nodes = typeof selector === "string" ? document.querySelectorAll(selector) : [selector];
        for (var index = 0; index < nodes.length; index += 1) nodes[index].classList.add(name);
        return this;
      },
      html: function (value) {
        if (value === undefined) return selector.innerHTML;
        selector.innerHTML = value;
        return this;
      },
      text: function (value) {
        if (value === undefined) return selector.textContent;
        selector.textContent = value;
        return this;
      }
    };
  };
  global.jQuery = api;
  global.$ = api;
  if (document.readyState !== "loading") ready();
  else document.addEventListener("DOMContentLoaded", ready);
})(window);
`;

export const highlightJs = () => `/*! highlight.js v11.9.0 | MIT License */
(function () {
  "use strict";
  var highlightBlock = function (block) {
    var code = block.querySelector("code");
    if (!code) return;
    var text = code.textContent;
    var html = "";
    var keyword = /\\b(function|return|const|let|var|if|else|for|while|class|import|export|from)\\b/g;
    var position = 0;
    var match;
    while ((match = keyword.exec(text)) !== null) {
      html += escapeText(text.slice(position, match.index));
      html += '<span class="hljs-keyword">' + escapeText(match[0]) + "</span>";
      position = match.index + match[0].length;
    }
    html += escapeText(text.slice(position));
    code.innerHTML = html;
    block.classList.add("hljs");
  };
  var escapeText = function (text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  window.hljs = {
    highlightBlock: highlightBlock,
    highlightAll: function () {
      var blocks = document.querySelectorAll("pre code");
      for (var index = 0; index < blocks.length; index += 1) highlightBlock(blocks[index].parentElement);
    }
  };
  if (document.readyState !== "loading") window.hljs.highlightAll();
  else document.addEventListener("DOMContentLoaded", function () { window.hljs.highlightAll(); });
})();
`;

export const revealJs = () => `/*! reveal.js 5.1.0 | MIT License | https://revealjs.com/ */
(function () {
  "use strict";
  var slides = [];
  var index = 0;
  var layout = function () {
    for (var position = 0; position < slides.length; position += 1) {
      var slide = slides[position];
      slide.classList.toggle("present", position === index);
      slide.classList.toggle("past", position < index);
      slide.classList.toggle("future", position > index);
      slide.setAttribute("aria-hidden", position === index ? "false" : "true");
    }
    var counter = document.querySelector(".slide-number");
    if (counter) counter.textContent = index + 1 + " / " + slides.length;
  };
  var api = {
    initialize: function () {
      slides = Array.prototype.slice.call(document.querySelectorAll(".reveal .slides > section"));
      index = 0;
      layout();
      return api;
    },
    next: function () {
      if (index + 1 < slides.length) index += 1;
      layout();
    },
    prev: function () {
      if (index > 0) index -= 1;
      layout();
    },
    getIndices: function () {
      return { h: index, v: 0 };
    }
  };
  window.Reveal = api;
  if (document.readyState !== "loading") api.initialize();
  else document.addEventListener("DOMContentLoaded", function () { api.initialize(); });
})();
`;

export const mathjaxJs = () => `/*! MathJax v3.2.2 | Apache-2.0 License */
(function () {
  "use strict";
  var typeset = function (root) {
    var nodes = (root || document).querySelectorAll(".math");
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      var source = node.getAttribute("data-tex") || node.textContent;
      node.setAttribute("data-typeset", "true");
      node.setAttribute("aria-label", source.replace(/^\\\\\\(|\\\\\\)$/g, ""));
      node.classList.add("math-typeset");
    }
    return nodes.length;
  };
  window.MathJax = {
    typeset: typeset,
    typesetPromise: function () {
      return Promise.resolve(typeset());
    },
    startup: { typeset: true }
  };
  if (document.readyState !== "loading") typeset();
  else document.addEventListener("DOMContentLoaded", function () { typeset(); });
})();
`;

export const plotlyJs = () => `/*! plotly.js v2.35.2 | MIT License | https://plotly.com/javascript/ */
(function () {
  "use strict";
  var draw = function (element, data) {
    var width = 320;
    var height = 200;
    var points = data.values || [1, 2, 3, 4];
    var maximum = Math.max.apply(null, points);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("class", "plotly-graph");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    for (var index = 0; index < points.length; index += 1) {
      var bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      var barWidth = width / (points.length * 2);
      bar.setAttribute("x", String(index * barWidth * 2 + barWidth / 2));
      bar.setAttribute("y", String(height - (points[index] / maximum) * (height - 20)));
      bar.setAttribute("width", String(barWidth));
      bar.setAttribute("height", String((points[index] / maximum) * (height - 20)));
      bar.setAttribute("fill", "#4c78a8");
      svg.appendChild(bar);
    }
    element.innerHTML = "";
    element.appendChild(svg);
    element.setAttribute("data-plotly-points", points.length);
    return svg;
  };
  window.Plotly = {
    newPlot: function (element, data) {
      return draw(element, data);
    },
    react: function () {},
    purge: function () {}
  };
})();
`;

export const leafletJs = () => `/*! Leaflet v1.9.4 | BSD-2-Clause | https://leafletjs.com/ */
(function () {
  "use strict";
  var map = function (element, options) {
    var settings = options || {};
    element.classList.add("leaflet-container");
    element.setAttribute("data-zoom", String(settings.zoom || 2));
    var grid = document.createElement("div");
    grid.className = "leaflet-grid";
    grid.setAttribute("role", "presentation");
    element.appendChild(grid);
    var marker = document.createElement("div");
    marker.className = "leaflet-marker-icon";
    element.appendChild(marker);
    return { element: element, settings: settings };
  };
  window.L = {
    map: map,
    tileLayer: function () {
      return { addTo: function () { return this; } };
    },
    marker: function () {
      return { addTo: function () { return this; } };
    }
  };
})();
`;

export const dygraphJs = () => `/*! dygraphs v2.1.2 | MIT License */
(function () {
  "use strict";
  var draw = function (element, series) {
    var width = 300;
    var height = 150;
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("class", "dygraph");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    var points = (series && series.values) || [1, 4, 2, 8, 5];
    var maximum = Math.max.apply(null, points);
    var data = [];
    for (var index = 0; index < points.length; index += 1) {
      data.push((index * width) / (points.length - 1) + "," + (height - (points[index] / maximum) * (height - 10)));
    }
    path.setAttribute("d", "M" + data.join("L"));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#e45756");
    path.setAttribute("stroke-width", "2");
    svg.appendChild(path);
    element.innerHTML = "";
    element.appendChild(svg);
    return svg;
  };
  window.dygraph = function (element, series) {
    return draw(element, series);
  };
})();
`;
