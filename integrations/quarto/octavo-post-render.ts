const files = (Deno.env.get("QUARTO_PROJECT_OUTPUT_FILES") ?? "").split(/\r?\n/).filter((f) => f.endsWith(".html"));
const level = Deno.env.get("OCTAVO_LEVEL") ?? "packed";

for (const file of files) {
  const candidate = `${file}.octavo`;
  const args = [file, candidate, "--level", level];
  const { success } = await new Deno.Command("octavo", { args, stdout: "inherit" }).output();
  if (success) await Deno.rename(candidate, file);
}
