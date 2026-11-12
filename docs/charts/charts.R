library(ggplot2)
library(scales)

args <- commandArgs(trailingOnly = TRUE)
root <- if (length(args) >= 1) args[[1]] else "."
out_dir <- file.path(root, "docs", "images")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

corpus <- read.csv(file.path(root, "docs", "charts", "corpus.csv"))
speed <- read.csv(file.path(root, "docs", "charts", "speed.csv"))

themes <- list(
  light = list(ink = "#1f2328", muted = "#59636e", grid = "#d8dee4", safe = "#a9c5f7", scripts = "#5f8fe8", packed = "#1d4ed8", accent = "#d4572a", second = "#8250df"),
  dark = list(ink = "#e6edf3", muted = "#9198a1", grid = "#30363d", safe = "#35508a", scripts = "#5a86d6", packed = "#8db4ff", accent = "#ff8a5c", second = "#b392f0")
)

base_theme <- function(p) {
  theme_minimal(base_size = 13, base_family = "sans") +
    theme(
      plot.background = element_rect(fill = "transparent", colour = NA),
      panel.background = element_rect(fill = "transparent", colour = NA),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(colour = p$grid, linewidth = 0.4),
      axis.text = element_text(colour = p$muted),
      axis.title = element_text(colour = p$muted),
      plot.title = element_text(colour = p$ink, face = "bold", size = 15, margin = margin(b = 4)),
      plot.subtitle = element_text(colour = p$muted, size = 11.5, margin = margin(b = 12)),
      legend.text = element_text(colour = p$ink),
      legend.title = element_blank(),
      legend.position = "top",
      legend.justification = "left",
      legend.margin = margin(0, 0, 4, 0),
      plot.margin = margin(14, 18, 12, 14),
      plot.title.position = "plot"
    )
}

save <- function(plot, name, width, height, mode) {
  file <- file.path(out_dir, sprintf("%s-%s.svg", name, mode))
  svglite::svglite(file, width = width, height = height, bg = "transparent")
  print(plot)
  dev.off()
}

upstream <- subset(corpus, grepl("^quarto-cli-", category) & packed_bytes > 0)
upstream$group <- factor(
  ifelse(upstream$category == "quarto-cli-html", "HTML pages",
    ifelse(upstream$category == "quarto-cli-slides", "Slide decks", "Dashboards")),
  levels = c("HTML pages", "Slide decks", "Dashboards")
)

share <- function(rows) {
  data.frame(
    safe = sum(rows$safe_bytes) / sum(rows$input_bytes),
    scripts = sum(rows$scripts_bytes) / sum(rows$input_bytes),
    packed = sum(rows$packed_bytes) / sum(rows$input_bytes)
  )
}
levels_table <- do.call(rbind, lapply(
  c("HTML pages", "Slide decks", "Dashboards", "All documents"),
  function(g) {
    rows <- if (g == "All documents") upstream else subset(upstream, group == g)
    s <- share(rows)
    data.frame(
      group = sprintf("%s (%d)", g, nrow(rows)),
      level = c("safe", "scripts", "packed"),
      share = c(s$safe, s$scripts, s$packed)
    )
  }
))
levels_table$group <- factor(levels_table$group, levels = rev(unique(levels_table$group)))
levels_table$level <- factor(levels_table$level, levels = c("safe", "scripts", "packed"))

levels_chart <- function(p) {
  ggplot(levels_table, aes(share, group, fill = level)) +
    geom_col(position = position_dodge2(width = 0.8, reverse = TRUE, padding = 0.12), width = 0.8) +
    geom_text(
      aes(label = percent(share, accuracy = 0.1)),
      position = position_dodge2(width = 0.8, reverse = TRUE, padding = 0.12), hjust = -0.15, size = 3.3, colour = p$ink
    ) +
    scale_fill_manual(values = c(safe = p$safe, scripts = p$scripts, packed = p$packed)) +
    scale_x_continuous(labels = percent_format(accuracy = 1), limits = c(0, 0.36), expand = c(0, 0)) +
    labs(
      title = "Output size by level",
      subtitle = "Share of the original file on Quarto's own test documents, smaller is better",
      x = NULL, y = NULL
    ) +
    guides(fill = guide_legend(reverse = FALSE)) +
    base_theme(p) +
    theme(panel.grid.major.y = element_blank(), axis.text.y = element_text(colour = p$ink))
}

shrink <- upstream$input_bytes / upstream$packed_bytes
median_shrink <- median(shrink)
distribution_chart <- function(p) {
  ggplot(data.frame(shrink = shrink), aes(shrink)) +
    geom_histogram(bins = 36, fill = p$packed, colour = NA, alpha = 0.92) +
    geom_vline(xintercept = median_shrink, colour = p$accent, linewidth = 0.9) +
    annotate(
      "text", x = median_shrink * 1.08, y = Inf, vjust = 1.6, hjust = 0,
      label = sprintf("median %.1fx", median_shrink), colour = p$accent, fontface = "bold", size = 4
    ) +
    scale_x_log10(breaks = c(1.5, 2, 5, 10, 20, 50), labels = function(x) paste0(x, "x")) +
    labs(
      title = "How much each document shrinks",
      subtitle = sprintf("%d Quarto test documents at the packed level", length(shrink)),
      x = "Original size divided by optimized size", y = "Documents"
    ) +
    base_theme(p) +
    theme(panel.grid.major.x = element_blank())
}

speed$mib <- speed$input_bytes / 1048576
speed$seconds <- speed$ms / 1000
speed$kind <- factor(
  ifelse(speed$kind == "deck", "Image-heavy slide decks", "Quarto pages and reports"),
  levels = c("Quarto pages and reports", "Image-heavy slide decks")
)
rates <- c(5, 10, 20)
speed_chart <- function(p) {
  guides_df <- data.frame(
    rate = rates,
    x = 17, y = 17 / rates,
    label = paste0(rates, " MiB/s")
  )
  ggplot(speed, aes(mib, seconds, colour = kind)) +
    geom_abline(slope = 1, intercept = -log10(rates), colour = p$grid, linewidth = 0.5) +
    geom_text(
      data = guides_df, aes(x = x, y = y, label = label), inherit.aes = FALSE,
      colour = p$muted, size = 3.2, hjust = 0, vjust = 0.5
    ) +
    geom_point(size = 3, alpha = 0.9) +
    scale_colour_manual(values = c(p$second, p$packed)) +
    scale_x_log10(
      breaks = c(0.1, 0.3, 1, 3, 10), labels = function(x) paste(x, "MiB"),
      limits = c(0.08, 40), expand = c(0, 0)
    ) +
    scale_y_log10(breaks = c(0.03, 0.1, 0.3, 1, 3), labels = function(x) paste0(x, " s"), limits = c(0.03, 5)) +
    labs(
      title = "Time to optimize",
      subtitle = "Packed level, default effort, 20 threads. Diagonals mark constant throughput.",
      x = "Input size", y = NULL
    ) +
    base_theme(p) +
    theme(panel.grid.major = element_line(colour = p$grid, linewidth = 0.35))
}

for (mode in names(themes)) {
  p <- themes[[mode]]
  save(levels_chart(p), "levels", 7.6, 4.4, mode)
  save(distribution_chart(p), "distribution", 7.6, 3.6, mode)
  save(speed_chart(p), "speed", 7.6, 3.8, mode)
}
cat("wrote", length(list.files(out_dir, pattern = "svg$")), "charts to", out_dir, "\n")
