# SKEWLINE

T.OF... のアプリ。https://t-of.github.io/skewline/（旧名「ひねり並べ」、旧 id `hineri`）

- ルールは本部の `~/GitHub/tof/t-of.github.io/RULES.md` に従う（全アプリ共通）。ブランドは `docs/BRAND.md`。
- 直したら本部で `npm run audit:browser -- skewline` を通す。
- 公開は本部の `docs/RELEASE.md` の手順。大きな作業は本部で Claude を起動すると、役割を分けて進められる。
- localStorage のキーは `skewline.` で始める。SW のキャッシュ名は `skewline-` で始める。旧 id `hineri.` のキーが残っていれば読み込んで引き継ぐ（消さない）。
