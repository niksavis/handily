- **`npm run lint` refuses raw invisible and bidi characters in mod sources.** A `.ts`,
  `.tsx` or `.mjs` file under `mods/` or `scripts/` that holds a raw character of class
  Cf, Zl or Zp, or a Bidi_Control character, fails the gate. The failure names the file,
  line, column and code point, and gives the `\u{...}` escape to write instead. Visible
  glyphs such as `●`, `✓`, `▶`, `○` and `…` still pass. The gate skips the generated
  `.claude-plugin/types` folders and `node_modules` (handily-3hz5).
