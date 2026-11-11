use anstream::{eprintln, println};
use anstyle::{AnsiColor, Style};
use bytesize::ByteSize;
use clap::{builder::Styles, value_parser, Args, Parser};
use indicatif::{ProgressBar, ProgressStyle};
use octavo::{
    optimize, simplify, Compression, ImageEncoding, ImageFormat, Mode, Options, Quality, Transform,
    Tuning, Warning,
};
use std::{
    collections::BTreeMap,
    fs,
    num::{NonZeroU32, NonZeroUsize},
    path::{Path, PathBuf},
    process::{self, ExitCode},
    time::{Duration, Instant},
};

const STYLES: Styles = Styles::styled()
    .header(AnsiColor::Green.on_default().bold())
    .usage(AnsiColor::Green.on_default().bold())
    .literal(AnsiColor::Cyan.on_default().bold())
    .placeholder(AnsiColor::Cyan.on_default());

const GOOD: Style = AnsiColor::Green.on_default().bold();
const WARN: Style = AnsiColor::Yellow.on_default().bold();
const ERROR: Style = AnsiColor::Red.on_default().bold();
const DIM: Style = Style::new().dimmed();

#[derive(Parser)]
#[command(
    name = "octavo",
    version,
    about = "Shrinks the self-contained HTML that Quarto writes",
    after_help = EXAMPLES,
    styles = STYLES,
    arg_required_else_help = true
)]
struct Cli {
    #[command(flatten)]
    optimize: Optimize,
    #[arg(
        short,
        long,
        value_name = "N",
        default_value_t = default_jobs(),
        help = "Worker threads, by default one per logical CPU"
    )]
    jobs: NonZeroUsize,
}

const EXAMPLES: &str = "\
Examples:
  octavo report.html                     write report.min.html
  octavo deck.html --level safe          keep the page working without JavaScript
  octavo deck.html --lossy-images        smaller, but images are not pixel-exact
  octavo report.html --maximum           the smallest output, however long it takes
  octavo report.html --audit             show what each step would save
  octavo report.html --verify 'node check.mjs {original} {optimized}'";

fn default_jobs() -> NonZeroUsize {
    std::thread::available_parallelism().unwrap_or(NonZeroUsize::MIN)
}

#[derive(Args)]
struct Optimize {
    #[arg(help = "HTML file written by Quarto with embed-resources: true")]
    input: PathBuf,
    #[arg(help = "Where to write the result [default: <input>.min.html]")]
    output: Option<PathBuf>,
    #[arg(
        short,
        long,
        value_name = "LEVEL",
        default_value_t = Mode::Packed,
        value_parser = value_parser!(Mode),
        help = "How much to rewrite. Output shrinks in this order: safe is the largest and works without JavaScript, scripts is smaller, packed is the smallest and needs JavaScript"
    )]
    level: Mode,
    #[arg(
        long,
        value_name = "COMMAND",
        help_heading = "Checking",
        help = "Run COMMAND on each result and keep the result only if it exits with 0. A failing result is replaced by the next level down (packed, then scripts, then safe). In COMMAND, {original} is the path of the input file and {optimized} the path of the result"
    )]
    verify: Option<String>,
    #[arg(
        long,
        conflicts_with_all = ["output", "verify"],
        help_heading = "Checking",
        help = "Show what each step would save, and write nothing"
    )]
    audit: bool,
    #[arg(
        long,
        value_name = "FORMAT",
        num_args = 0..=1,
        default_missing_value = "avif",
        value_parser = value_parser!(ImageFormat),
        help_heading = "Images",
        help = "Re-encode PNG and JPEG images as avif (the default) or webp. Much smaller, not pixel-exact"
    )]
    lossy_images: Option<ImageFormat>,
    #[arg(
        long,
        value_name = "QUALITY",
        requires = "lossy_images",
        value_parser = value_parser!(u8).range(1..=100),
        help_heading = "Images",
        help = "Quality from 1 to 100 [default: 60 for avif, 80 for webp]"
    )]
    image_quality: Option<u8>,
    #[arg(
        long,
        value_name = "PIXELS",
        requires = "lossy_images",
        value_parser = parse_nonzero_side,
        help_heading = "Images",
        help = "Shrink images whose longest side is over this many pixels [default: 3840]"
    )]
    max_image_side: Option<NonZeroU32>,
    #[arg(
        long,
        help_heading = "Fonts",
        help = "Keep only the characters each text font needs. Often a large saving, but some letter pairs come out about a pixel wider"
    )]
    subset_text_fonts: bool,
    #[arg(
        long,
        value_name = "DIRECTORY",
        help_heading = "Fonts",
        help = "Remember converted fonts here, so later runs skip the slowest step"
    )]
    cache_dir: Option<PathBuf>,
    #[arg(
        long,
        help_heading = "Compression",
        help = "Use the slowest settings everywhere, whatever it costs in time. Cannot be combined with the three options below"
    )]
    maximum: bool,
    #[arg(
        long,
        value_name = "0-11",
        value_parser = clap::value_parser!(u8).range(0..=11),
        conflicts_with = "maximum",
        help_heading = "Compression",
        help = "Quality of re-encoded fonts [default: 9, slowest: 11]"
    )]
    woff2_quality: Option<u8>,
    #[arg(
        long,
        value_name = "0-6",
        value_parser = clap::value_parser!(u8).range(0..=6),
        conflicts_with = "maximum",
        help_heading = "Compression",
        help = "oxipng preset for PNG images [default: chosen by image size, slowest: 6]"
    )]
    png_preset: Option<u8>,
    #[arg(
        long,
        value_name = "0-11",
        value_parser = clap::value_parser!(u8).range(0..=11),
        conflicts_with = "maximum",
        help_heading = "Compression",
        help = "Quality of the packed blob [default: 9, slowest: 11]"
    )]
    brotli_quality: Option<u8>,
    #[arg(
        long,
        help_heading = "Licenses",
        help = "Drop the license and copyright notices of bundled libraries and fonts. Most licenses require keeping them"
    )]
    strip_licenses: bool,
}

fn parse_nonzero_side(value: &str) -> Result<NonZeroU32, String> {
    let pixels: u32 = value
        .parse()
        .map_err(|error| format!("invalid pixel count '{value}': {error}"))?;
    NonZeroU32::new(pixels).ok_or_else(|| "the pixel count must be at least 1".to_string())
}

fn ladder(level: Mode) -> &'static [Mode] {
    match level {
        Mode::Packed => &[Mode::Packed, Mode::Scripts, Mode::Safe],
        Mode::Scripts => &[Mode::Scripts, Mode::Safe],
        Mode::Safe => &[Mode::Safe],
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    if let Err(error) = rayon::ThreadPoolBuilder::new()
        .num_threads(cli.jobs.get())
        .build_global()
    {
        eprintln!("{ERROR}error{ERROR:#}: {error}");
        return ExitCode::FAILURE;
    }
    let result = if cli.optimize.audit {
        audit(&cli.optimize.input)
    } else {
        let Optimize {
            input,
            output,
            level,
            verify,
            audit: _,
            lossy_images,
            image_quality,
            subset_text_fonts,
            max_image_side,
            strip_licenses,
            cache_dir,
            maximum,
            woff2_quality,
            png_preset,
            brotli_quality,
        } = cli.optimize;
        let output = output.unwrap_or_else(|| input.with_extension("min.html"));
        let images = lossy_images.map(|format| {
            let encoding = ImageEncoding::new(format);
            ImageEncoding {
                quality: image_quality
                    .and_then(Quality::new)
                    .unwrap_or(encoding.quality),
                max_side: max_image_side.or(encoding.max_side),
                ..encoding
            }
        });
        let options = Options {
            images,
            subset_text_fonts,
            strip_licenses,
            cache_directory: cache_dir,
            compression: if maximum {
                Compression::Maximum
            } else if woff2_quality.is_some() || png_preset.is_some() || brotli_quality.is_some() {
                Compression::Custom(Tuning {
                    woff2_quality: woff2_quality.unwrap_or(Tuning::BALANCED.woff2_quality),
                    png_preset,
                    brotli_quality,
                })
            } else {
                Compression::Balanced
            },
        };
        run(&input, &output, level, verify.as_deref(), options)
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{ERROR}error{ERROR:#}: {message}");
            ExitCode::FAILURE
        }
    }
}

fn read(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn write(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| format!("{}: {e}", path.display()))
}

fn staging_path(output: &Path) -> PathBuf {
    let mut name = output.file_name().unwrap_or_default().to_os_string();
    name.push(".octavo-tmp");
    output.with_file_name(name)
}

fn same_file(a: &Path, b: &Path) -> bool {
    matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(a), Ok(b)) if a == b)
}

fn size(bytes: usize) -> String {
    ByteSize(bytes as u64).to_string()
}

#[derive(Default)]
struct Savings {
    count: usize,
    before: usize,
    after: usize,
}

fn audit(input: &Path) -> Result<(), String> {
    let src = read(input)?;
    let out =
        optimize(&src, Mode::Packed).map_err(|error| format!("{}: {error}", input.display()))?;
    let mut totals: BTreeMap<Transform, Savings> = BTreeMap::new();
    for step in &out.applied {
        let total = totals.entry(step.transform).or_default();
        total.count += 1;
        total.before += step.before;
        total.after += step.after;
    }
    println!(
        "{DIM}{:<18} {:>5} {:>10} {:>10} {:>10}{DIM:#}",
        "transformation", "count", "before", "after", "saved"
    );
    for (name, total) in totals {
        println!(
            "{name:<18} {:>5} {:>10} {:>10} {GOOD}{:>10}{GOOD:#}",
            total.count,
            size(total.before),
            size(total.after),
            size(total.before.saturating_sub(total.after)),
        );
    }
    println!("{}", summary(src.len(), out.html.len()));
    Ok(())
}

fn summary(before: usize, after: usize) -> String {
    format!(
        "{} -> {GOOD}{}{GOOD:#} ({GOOD}{:.1}x smaller{GOOD:#})",
        size(before),
        size(after),
        before as f64 / after as f64
    )
}

fn warn(warnings: &[Warning]) {
    for warning in warnings {
        eprintln!("{WARN}warning{WARN:#}: {warning}");
    }
}

fn spinner() -> ProgressBar {
    let style = ProgressStyle::with_template("{spinner:.cyan} {msg} {elapsed:.dim}")
        .expect("valid template");
    let bar = ProgressBar::new_spinner().with_style(style);
    bar.enable_steady_tick(Duration::from_millis(100));
    bar
}

fn run(
    input: &Path,
    output: &Path,
    level: Mode,
    verify: Option<&str>,
    options: Options,
) -> Result<(), String> {
    let started = Instant::now();
    let src = read(input)?;
    let progress = spinner();
    progress.set_message("optimizing");
    let simplified =
        simplify(&src, options).map_err(|error| format!("{}: {error}", input.display()))?;
    for mode in ladder(level) {
        progress.set_message(format!("packing ({mode})"));
        let candidate = simplified.pack(*mode).html;
        if candidate.len() >= src.len() {
            continue;
        }
        let staged = staging_path(output);
        write(&staged, &candidate)?;
        if let Some(command) = verify {
            progress.set_message(format!("verifying ({mode})"));
            if !passes(command, input, &staged) {
                let _ = fs::remove_file(&staged);
                continue;
            }
        }
        fs::rename(&staged, output).map_err(|e| format!("{}: {e}", output.display()))?;
        progress.finish_and_clear();
        warn(simplified.warnings());
        println!(
            "{} {DIM}[{}, {:.1?}]{DIM:#} {}",
            output.display(),
            mode,
            started.elapsed(),
            summary(src.len(), candidate.len())
        );
        return Ok(());
    }
    progress.finish_and_clear();
    warn(simplified.warnings());
    if !same_file(input, output) {
        write(output, &src)?;
    }
    println!(
        "{WARN}kept the original{WARN:#} {DIM}({}){DIM:#}",
        size(src.len())
    );
    Ok(())
}

fn passes(command: &str, original: &Path, optimized: &Path) -> bool {
    let command = command
        .replace("{original}", &original.to_string_lossy())
        .replace("{optimized}", &optimized.to_string_lossy());
    let (shell, flag) = if cfg!(windows) {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    };
    process::Command::new(shell)
        .args([flag, &command])
        .status()
        .is_ok_and(|s| s.success())
}
