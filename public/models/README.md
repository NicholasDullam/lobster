## Available model configurations

The app now supports multiple named model configurations through the
`model` query parameter. Each configuration can define its own GLB asset,
optional overrides JSON, and base fit transform.

- `lobster` (default): `/models/lobster.glb`
- `bowling-hat`: `/models/bowling-hat.glb`

The default lobster configuration also loads runtime material overrides from
`/models/lobster-overrides.json`.

Examples:

- Main demo: `?model=lobster`
- Main demo with bowling hat: `?model=bowling-hat`
- Spin preview with bowling hat: `spin.html?model=bowling-hat`

## Runtime face-through tuning

The renderer applies a runtime material profile after loading the GLB so the
filter can behave like an overlay instead of a fully opaque mask.

Default profile behavior:
- Keeps the full model opaque by default.
- Applies stronger face-through settings to meshes/materials whose names match:
  `face|head|visor|window|opening|mask|hood`.
- Applies non-global pass-through with local cutout windows configured in
  `lobster-overrides.json`.

### Query parameter overrides

You can tune the profile without code edits by adding query params:

- `filterOpacity` (0..1)
- `filterAlphaTest` (0..1)
- `filterDepthWrite` (`true`/`false` or `1`/`0`)
- `filterDepthTest` (`true`/`false` or `1`/`0`)
- `filterDoubleSided` (`true`/`false` or `1`/`0`)
- `filterTransparent` (`true`/`false` or `1`/`0`)
- `filterRenderOrder` (number)
- `filterDumpMeshes=1` logs mesh/material catalog in browser console for matcher authoring
- `filterDebugCutout=1` shows wireframe/local center debug helpers for cutout alignment
- `filterDebugCutout=0` hides cutout debug helpers even when `debug=1`
  - In this mode, drag the yellow center dot to snap the cutout center to mesh surface.
  - A bottom-right "Cutout Tuner" panel exposes radii/feather sliders and a "Copy JSON" button.
  - `filterDebugOcclusion=1|0` toggles shader occlusion tint visualization.
  - `filterDebugSuitOpacity=<0.05..0.9>` sets translucent suit opacity for tuning.
- `filterCutoutMatcher` (pipe-delimited mesh/material matcher)
- `filterCutoutCenter` (comma tuple: `x,y,z` in mesh-local space)
- `filterCutoutRadii` (comma tuple: `x,y,z` in mesh-local space)
- `filterCutoutFeather` (number, normalized edge softness)
- `filterCutoutEnabled` (`true`/`false` or `1`/`0`)

Optional targeted override:
- `filterTarget` (pipe-delimited matcher terms, e.g. `face|visor`)
- `filterTargetOpacity`, `filterTargetAlphaTest`
- `filterTargetDepthWrite`, `filterTargetDepthTest`
- `filterTargetDoubleSided`, `filterTargetTransparent`
- `filterTargetRenderOrder`

Example:

`?sample=sample-2&filterDumpMeshes=1&filterCutoutMatcher=textured_meshobj|pbr_material&filterCutoutCenter=0.02,0.5,0.2&filterCutoutRadii=0.16,0.16,0.17&filterCutoutFeather=0.2`

### Recommended workflow

1. Start with `?sample=sample-1`, `?sample=sample-2`, `?sample=sample-3`.
2. Open once with `filterDumpMeshes=1` and collect exact mesh/material names.
3. Tune the selected model's overrides JSON first for non-global pass-through.
4. Use query params for live tuning, then copy final values back to JSON.
5. If depth popping appears, test `filterTargetDepthWrite=false`.
6. Keep one shared setting set that looks acceptable across all sample routes.

If runtime tuning is still not enough for desired quality, move to a model
authoring pass (geometry cutout and/or alpha mask in the GLB).

## GitHub Pages note

Hosted GitHub Pages links should prefer query parameters over deep sample paths.
`?sample=sample-1` works on both local Vite and Pages, while `/samples/sample-1`
requires a host-specific route fallback that GitHub Pages does not provide by
default.
