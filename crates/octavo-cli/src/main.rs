use anstream::{eprintln, println};
use anstyle::{AnsiColor, Style};
use bytesize::ByteSize;
use clap::{
    Args, CommandFactory, FromArgMatches, Parser, ValueEnum, builder::Styles, value_parser,
};
use indicatif::{ProgressBar, ProgressStyle};
use octavo::{
    Compression, Error as OctavoError, ImageEncoding, ImageFormat, Loaded, Mode, Options, Quality,
    Resources, SiteKind, Transform, Tuning, Warning, embed_resources, optimize, optimize_directory,
    simplify,
};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    num::{NonZeroU32, NonZeroUsize},
    path::{Path, PathBuf},
    process::ExitCode,
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
    about = "Shrinks the self-contained HTML that Quarto writes, or the shared files of a rendered site",
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
    #[arg(
        long,
        value_name = "SHELL",
        help_heading = "Shell",
        help = "Print a completion script for your shell and exit: bash, elvish, fish, nushell, powershell or zsh"
    )]
    completions: Option<CompletionShell>,
}

#[derive(Clone, Copy, ValueEnum)]
enum CompletionShell {
    Bash,
    Elvish,
    Fish,
    Nushell,
    Powershell,
    Zsh,
}

fn print_completions(shell: CompletionShell) {
    use clap_complete::{Shell, generate};
    let mut command = command();
    let mut out = std::io::stdout();
    match shell {
        CompletionShell::Bash => generate(Shell::Bash, &mut command, "octavo", &mut out),
        CompletionShell::Elvish => generate(Shell::Elvish, &mut command, "octavo", &mut out),
        CompletionShell::Fish => generate(Shell::Fish, &mut command, "octavo", &mut out),
        CompletionShell::Powershell => {
            generate(Shell::PowerShell, &mut command, "octavo", &mut out)
        }
        CompletionShell::Zsh => generate(Shell::Zsh, &mut command, "octavo", &mut out),
        CompletionShell::Nushell => generate(
            clap_complete_nushell::Nushell,
            &mut command,
            "octavo",
            &mut out,
        ),
    }
}

const EXAMPLES: &str = "\
Examples:
  octavo report.html                     write report.min.html
  octavo deck.html --level safe          keep the page working without JavaScript
  octavo deck.html --lossy-images        smaller, but images are not pixel-exact
  octavo report.html --maximum           the smallest output, however long it takes
  octavo report.html --audit             show what each step would save
  octavo _site                           optimize a rendered site's shared files once";

fn default_jobs() -> NonZeroUsize {
    std::thread::available_parallelism().unwrap_or(NonZeroUsize::MIN)
}

#[derive(Args)]
struct Optimize {
    #[arg(
        required_unless_present = "completions",
        help = "HTML file written by Quarto with embed-resources: true, or the output directory of a rendered site"
    )]
    input: Option<PathBuf>,
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
        conflicts_with = "output",
        help = "Show what each step would save at --level, and write nothing"
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
    )]
    image_quality: Option<u8>,
    #[arg(
        long,
        value_name = "PIXELS",
        requires = "lossy_images",
        value_parser = parse_nonzero_side,
        help_heading = "Images",
    )]
    max_image_side: Option<NonZeroU32>,
    #[arg(
        long,
        help_heading = "Images",
        help = "Keep PNG images as PNG. By default an 8-bit PNG becomes lossless WebP when that is smaller, with the same pixels"
    )]
    keep_png: bool,
    #[arg(
        long,
        value_name = "MIB",
        conflicts_with = "keep_png",
        help_heading = "Images"
    )]
    image_memory: Option<u64>,
    #[arg(
        long,
        help_heading = "Sites",
        help = "Rewrite a site directory where it is, which cannot be undone. Needed when the output is the input. Run site mode on a complete, fresh render: rules that no page uses are removed"
    )]
    in_place: bool,
    #[arg(
        long,
        value_name = "DIR",
        help_heading = "Resources",
        help = "Directory to search for files that the page links, after its own directory and that directory's parents. Can be repeated"
    )]
    resource_path: Vec<PathBuf>,
    #[arg(
        long,
        help_heading = "Resources",
        help = "Do not download files that the page links from the web. Such a page keeps needing the network"
    )]
    no_fetch: bool,
    #[arg(
        long,
        help_heading = "Fonts",
        help = "Keep only the characters each text font needs. Often a large saving, but on Linux some hinted fonts draw with slightly different strokes"
    )]
    subset_fonts: bool,
    #[arg(
        long,
        value_name = "DIRECTORY",
        help_heading = "Fonts",
        help = "Where converted fonts are remembered, so later runs skip the slowest step [default: the octavo folder in your user cache directory]"
    )]
    cache_dir: Option<PathBuf>,
    #[arg(
        long,
        conflicts_with = "cache_dir",
        help_heading = "Fonts",
        help = "Do not remember converted fonts"
    )]
    no_cache: bool,
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
    )]
    woff2_quality: Option<u8>,
    #[arg(
        long,
        value_name = "0-6",
        value_parser = clap::value_parser!(u8).range(0..=6),
        conflicts_with = "maximum",
        help_heading = "Compression",
    )]
    png_preset: Option<u8>,
    #[arg(
        long,
        value_name = "0-11",
        value_parser = clap::value_parser!(u8).range(0..=11),
        conflicts_with = "maximum",
        help_heading = "Compression",
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

fn default_cache_dir() -> Option<PathBuf> {
    dirs::cache_dir().map(|directory| directory.join("octavo"))
}

fn command() -> clap::Command {
    let avif = ImageEncoding::new(ImageFormat::Avif);
    let webp = ImageEncoding::new(ImageFormat::Webp);
    let side = avif
        .max_side
        .map_or_else(String::new, |side| format!(" [default: {side}]"));
    let (balanced, maximum) = (Tuning::BALANCED, Tuning::MAXIMUM);
    Cli::command()
        .mut_arg("image_quality", |arg| {
            arg.help(format!(
                "Quality from 1 to 100 [default: {} for avif, {} for webp]",
                avif.quality.get(),
                webp.quality.get()
            ))
        })
        .mut_arg("image_memory", |arg| {
            arg.help(format!(
                "Memory the lossless WebP encoder may use at once, in MiB. Larger images stay PNG [default: {}]",
                Options::DEFAULT_IMAGE_MEMORY / 1_048_576
            ))
        })
        .mut_arg("max_image_side", |arg| {
            arg.help(format!(
                "Shrink images whose longest side is over this many pixels{side}"
            ))
        })
        .mut_arg("woff2_quality", |arg| {
            arg.help(format!(
                "Quality of re-encoded fonts [default: {}, slowest: {}]",
                balanced.woff2_quality, maximum.woff2_quality
            ))
        })
        .mut_arg("png_preset", |arg| {
            arg.help(format!(
                "oxipng preset for PNG images [default: chosen by image size, slowest: {}]",
                maximum.png_preset.unwrap_or_default()
            ))
        })
        .mut_arg("brotli_quality", |arg| {
            arg.help(format!(
                "Quality of the packed blob [default: {}, slowest: {}]",
                Tuning::DEFAULT_BROTLI_QUALITY,
                maximum.brotli_quality.unwrap_or_default()
            ))
        })
}

fn main() -> ExitCode {
    let cli = match Cli::from_arg_matches(&command().get_matches()) {
        Ok(cli) => cli,
        Err(error) => error.exit(),
    };
    if let Some(shell) = cli.completions {
        print_completions(shell);
        return ExitCode::SUCCESS;
    }
    if let Err(error) = rayon::ThreadPoolBuilder::new()
        .num_threads(cli.jobs.get())
        .build_global()
    {
        eprintln!("{ERROR}error{ERROR:#}: {error}");
        return ExitCode::FAILURE;
    }
    let Optimize {
        input,
        output,
        level,
        audit: audit_only,
        lossy_images,
        image_quality,
        subset_fonts,
        max_image_side,
        keep_png,
        image_memory,
        in_place,
        resource_path,
        no_fetch,
        strip_licenses,
        cache_dir,
        no_cache,
        maximum,
        woff2_quality,
        png_preset,
        brotli_quality,
    } = cli.optimize;
    let Some(input) = input else {
        eprintln!("{ERROR}error{ERROR:#}: no input file was given");
        return ExitCode::FAILURE;
    };
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
        subset_text_fonts: subset_fonts,
        strip_licenses,
        keep_png,
        image_memory: image_memory.map(|mib| mib.saturating_mul(1_048_576)),
        cache_directory: if no_cache {
            None
        } else {
            cache_dir.or_else(default_cache_dir)
        },
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
    let result = if input.is_dir() {
        if audit_only {
            Err("--audit works on one file, not a directory".to_string())
        } else if !resource_path.is_empty() {
            Err("--resource-path applies to one file, not a directory".to_string())
        } else if lossy_images.is_some() {
            Err(
                "--lossy-images does not apply to a directory, because files keep their names"
                    .to_string(),
            )
        } else {
            run_site(&input, output, &options, in_place)
        }
    } else if audit_only {
        audit(&input, level, &resource_path, !no_fetch)
    } else {
        let output = output.unwrap_or_else(|| input.with_extension("min.html"));
        run(&input, &output, level, options, &resource_path, !no_fetch)
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

fn audit(input: &Path, level: Mode, resource_paths: &[PathBuf], fetch: bool) -> Result<(), String> {
    let (src, _) = prepare(input, read(input)?, resource_paths, fetch);
    let out = optimize(&src, level).map_err(|error| failure(input, &error))?;
    let mut totals: BTreeMap<Transform, Savings> = BTreeMap::new();
    for step in &out.applied {
        let total = totals.entry(step.transform).or_default();
        total.count += 1;
        total.before += step.before;
        total.after += step.after;
    }
    println!(
        "{DIM}{:<18} {:>5} {:>10} {:>10} {:>10}{DIM:#}",
        "step", "count", "before", "after", "saved"
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
    println!(
        "
{level} level: {}",
        summary(src.len(), out.html.len())
    );
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

fn run_site(
    input: &Path,
    output: Option<PathBuf>,
    options: &Options,
    in_place: bool,
) -> Result<(), String> {
    let started = Instant::now();
    let output = match output {
        Some(output) => output,
        None => {
            let root = fs::canonicalize(input).map_err(|e| format!("{}: {e}", input.display()))?;
            let mut name = root.file_name().unwrap_or_default().to_os_string();
            name.push(".min");
            root.with_file_name(name)
        }
    };
    let same = fs::canonicalize(&output)
        .is_ok_and(|existing| fs::canonicalize(input).is_ok_and(|root| root == existing));
    if same && !in_place {
        return Err(format!(
            "{} is both the input and the output. Pass --in-place to rewrite it, which cannot be undone, or choose another output",
            output.display()
        ));
    }
    let progress = spinner();
    progress.set_message("optimizing the shared files");
    let report = optimize_directory(input, &output, options).map_err(|e| e.to_string())?;
    progress.finish_and_clear();
    for warning in &report.warnings {
        eprintln!("{WARN}warning{WARN:#}: {warning}");
    }
    let mut by_kind: BTreeMap<SiteKind, Savings> = BTreeMap::new();
    for change in &report.changes {
        let total = by_kind.entry(change.kind).or_default();
        total.count += 1;
        total.before += change.before as usize;
        total.after += change.after as usize;
    }
    println!(
        "{DIM}{:<12} {:>5} {:>10} {:>10} {:>10}{DIM:#}",
        "files", "count", "before", "after", "saved"
    );
    for (kind, total) in &by_kind {
        println!(
            "{:<12} {:>5} {:>10} {:>10} {GOOD}{:>10}{GOOD:#}",
            site_kind_name(*kind),
            total.count,
            size(total.before),
            size(total.after),
            size(total.before.saturating_sub(total.after)),
        );
    }
    let saved: usize = by_kind
        .values()
        .map(|total| total.before.saturating_sub(total.after))
        .sum();
    let before = report.bytes as usize;
    let after = before.saturating_sub(saved);
    println!(
        "
{} {DIM}[{} pages, {} files, {:.1?}]{DIM:#} {}",
        output.display(),
        report.pages,
        report.files,
        started.elapsed(),
        if after < before {
            summary(before, after)
        } else {
            size(before)
        }
    );
    Ok(())
}

fn site_kind_name(kind: SiteKind) -> &'static str {
    match kind {
        SiteKind::Stylesheet => "stylesheets",
        SiteKind::Script => "scripts",
        SiteKind::Font => "fonts",
        SiteKind::Image => "images",
    }
}

fn run(
    input: &Path,
    output: &Path,
    level: Mode,
    options: Options,
    resource_paths: &[PathBuf],
    fetch: bool,
) -> Result<(), String> {
    let started = Instant::now();
    let original = read(input)?;
    let original_len = original.len();
    let progress = spinner();
    progress.set_message("reading the page");
    let (src, linked) = prepare(input, original, resource_paths, fetch);
    progress.set_message("optimizing");
    let simplified = simplify(&src, options).map_err(|error| failure(input, &error))?;
    progress.set_message(format!("packing ({level})"));
    let candidate = simplified.pack(level).html;
    progress.finish_and_clear();
    warn(simplified.warnings());
    if candidate.len() >= src.len() && linked.is_none() {
        if !same_file(input, output) {
            write(output, &src)?;
        }
        println!(
            "{WARN}kept the original{WARN:#} {DIM}({}){DIM:#}",
            size(src.len())
        );
        return Ok(());
    }
    let text = if candidate.len() < src.len() {
        &candidate
    } else {
        &src
    };
    let staged = staging_path(output);
    write(&staged, text)?;
    fs::rename(&staged, output).map_err(|e| format!("{}: {e}", output.display()))?;
    let embedded = linked
        .as_ref()
        .map(|linked| format!(", {} linked files embedded", linked.files))
        .unwrap_or_default();
    let before = original_len + linked.map_or(0, |linked| linked.bytes as usize);
    println!(
        "{} {DIM}[{}, {:.1?}{embedded}]{DIM:#} {}",
        output.display(),
        level,
        started.elapsed(),
        summary(before, text.len())
    );
    Ok(())
}

struct Linked {
    files: usize,
    bytes: u64,
}

fn prepare(
    input: &Path,
    original: String,
    resource_paths: &[PathBuf],
    fetch: bool,
) -> (String, Option<Linked>) {
    let mut resources = FsResources::new(input, resource_paths, fetch);
    let embedded = embed_resources(&original, &mut resources);
    if embedded.embedded == 0 {
        return (original, None);
    }
    let linked = Linked {
        files: embedded.embedded,
        bytes: embedded.resource_bytes,
    };
    (embedded.html, Some(linked))
}

fn failure(input: &Path, error: &OctavoError) -> String {
    let hint = if matches!(error, OctavoError::NotSelfContained(_)) {
        "\nOctavo looked next to the page, in its parent directories and in each --resource-path. Use --resource-path <DIR> to name another directory to search"
    } else {
        ""
    };
    format!("{}: {error}{hint}", input.display())
}

const PARENTS_SEARCHED: usize = 9;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 octavo";
const DOWNLOAD_LIMIT: u64 = 64 * 1024 * 1024;

struct FsResources {
    page_dir: PathBuf,
    extra: Vec<PathBuf>,
    agent: Option<ureq::Agent>,
    failed: HashSet<String>,
}

impl FsResources {
    fn new(input: &Path, extra: &[PathBuf], fetch: bool) -> FsResources {
        let page_dir = fs::canonicalize(input)
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."));
        let agent = fetch.then(|| {
            ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(30)))
                .user_agent(USER_AGENT)
                .build()
                .into()
        });
        FsResources {
            page_dir,
            extra: extra.to_vec(),
            agent,
            failed: HashSet::new(),
        }
    }

    fn download(&mut self, url: String) -> Option<Loaded> {
        let agent = self.agent.as_ref()?;
        if self.failed.contains(&url) {
            return None;
        }
        let fetched = agent
            .get(&url)
            .call()
            .map_err(|error| error.to_string())
            .and_then(|mut response| {
                let content_type = response
                    .headers()
                    .get("content-type")
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                response
                    .body_mut()
                    .with_config()
                    .limit(DOWNLOAD_LIMIT)
                    .read_to_vec()
                    .map(|bytes| Loaded {
                        bytes,
                        id: url.clone(),
                        content_type,
                    })
                    .map_err(|error| error.to_string())
            });
        if let Err(error) = &fetched {
            eprintln!("{WARN}warning{WARN:#}: could not download {url}: {error}");
        }
        if fetched.is_err() {
            self.failed.insert(url);
        }
        fetched.ok()
    }

    fn candidates(&self, relative: &str, from: &str) -> Vec<PathBuf> {
        let trimmed = relative.trim_start_matches('/');
        let mut found = Vec::new();
        if !relative.starts_with('/') {
            let base = if from.is_empty() {
                Some(self.page_dir.as_path())
            } else {
                Path::new(from).parent()
            };
            found.extend(base.map(|directory| directory.join(trimmed)));
        }
        found.extend(self.extra.iter().map(|directory| directory.join(trimmed)));
        found.extend(
            self.page_dir
                .ancestors()
                .take(PARENTS_SEARCHED)
                .map(|directory| directory.join(trimmed)),
        );
        let parts: Vec<&str> = trimmed.split('/').collect();
        if let Some(at) = parts
            .iter()
            .position(|part| *part == "site_libs" || part.ends_with("_files"))
        {
            let suffix = parts[at..].join("/");
            found.extend(
                self.page_dir
                    .ancestors()
                    .take(PARENTS_SEARCHED)
                    .map(|directory| directory.join(&suffix)),
            );
        }
        found
    }
}

impl Resources for FsResources {
    fn load(&mut self, reference: &str, from: &str) -> Option<Loaded> {
        let reference = reference.trim();
        if let Some(url) = remote_url(reference, from) {
            return self.download(url);
        }
        let end = reference.find(['?', '#']).unwrap_or(reference.len());
        let decoded = percent_encoding::percent_decode_str(&reference[..end])
            .decode_utf8()
            .ok()?;
        self.candidates(&decoded, from)
            .into_iter()
            .find_map(|path| {
                let bytes = fs::read(&path).ok()?;
                let id = fs::canonicalize(&path).unwrap_or(path);
                Some(Loaded {
                    bytes,
                    id: id.to_string_lossy().into_owned(),
                    content_type: None,
                })
            })
    }
}

fn is_web(reference: &str) -> bool {
    reference.starts_with("http://") || reference.starts_with("https://")
}

fn remote_url(reference: &str, from: &str) -> Option<String> {
    if is_web(reference) {
        return Some(reference.to_string());
    }
    if let Some(rest) = reference.strip_prefix("//") {
        let scheme = if from.starts_with("http://") {
            "http"
        } else {
            "https"
        };
        return Some(format!("{scheme}://{rest}"));
    }
    is_web(from).then(|| join_url(from, reference))
}

fn join_url(base: &str, reference: &str) -> String {
    let base = &base[..base.find(['?', '#']).unwrap_or(base.len())];
    let scheme_end = base.find("://").map_or(0, |at| at + 3);
    let path_start = base[scheme_end..]
        .find('/')
        .map_or(base.len(), |at| scheme_end + at);
    let (origin, base_path) = base.split_at(path_start);
    let end = reference.find(['?', '#']).unwrap_or(reference.len());
    let (path, suffix) = reference.split_at(end);
    let mut segments: Vec<&str> = if path.starts_with('/') {
        Vec::new()
    } else {
        let mut directory: Vec<&str> = base_path.split('/').skip(1).collect();
        directory.pop();
        directory
    };
    for piece in path.split('/') {
        match piece {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }
    format!("{origin}/{}{suffix}", segments.join("/"))
}
