/* Site content — edit everything about reon here. */
window.SITE = {
  name: 'reon',
  role: 'Design engineer',
  year: 2026,
  email: 'reon.hypr@gmail.com',
  socials: [
    { label: 'X/Twitter', href: '#' },
    { label: 'Dribbble', href: '#' },
    { label: 'GitHub', href: '#' }
  ],

  /* Shown in this order in the work index. */
  projects: [
    {
      slug: 'fieldnote',
      title: 'Fieldnote™',
      year: '2024–2026',
      art: 'fieldnote',
      role: 'Founder, design & engineering',
      type: 'Product',
      status: 'In progress',
      summary: 'A local-first research notebook that lets design teams collect, tag and remix what they learn without losing the thread.',
      body: [
        'Fieldnote started as a weekend prototype for keeping interview snippets, screenshots and half-formed ideas in one place. It grew into a sync engine, a block editor and a canvas where every note can be picked up and rearranged.',
        'I work across the whole stack, from interaction details to the CRDT-backed data layer. The rule that guides it: capturing should take one keystroke, and finding things later should feel like remembering.'
      ]
    },
    {
      slug: 'kiln',
      title: 'Kiln Display',
      year: '2025',
      art: 'kiln',
      role: 'Type design',
      type: 'Variable font',
      status: 'Released',
      summary: 'A wide, warm grotesque with a width axis from 62 to 125, drawn for headlines that need to shout politely.',
      body: [
        'Kiln began as lettering for a poster series and slowly earned a full character set. Its wide masters keep generous counters so it stays legible when set huge and tight.',
        'The family ships as a single variable file with width and weight axes, plus a small set of stylistic alternates for the moments when a headline needs a little more personality.'
      ]
    },
    {
      slug: 'halftone-lab',
      title: 'Halftone Lab',
      year: '2025',
      art: 'halftone',
      role: 'Design & engineering',
      type: 'Web tool',
      status: 'Open source',
      summary: 'A browser playground for ordered dithering and halftone screens, compiled to WebAssembly so it stays fast on huge images.',
      body: [
        'Halftone Lab turns photos into Bayer patterns, error-diffused grain and classic print screens, with live previews at full resolution.',
        'The image kernels are written in Rust and compiled to WASM; the interface is a single canvas with keyboard-first controls, so you can scrub through settings without touching a slider.'
      ]
    },
    {
      slug: 'palette-forge',
      title: 'Palette Forge',
      year: '2024',
      art: 'palette',
      role: 'Design & engineering',
      type: 'Figma plugin',
      status: 'Public',
      summary: 'Generates perceptually even color ramps and checks every pair for contrast before you ship them.',
      body: [
        'Pick a few anchor colors and Palette Forge fills in the steps in OKLCH, keeping lightness consistent across hues so a "500" always feels like a "500".',
        'Every swatch carries its contrast ratios with it, and the plugin writes the result straight into variables and styles.'
      ]
    },
    {
      slug: 'motion-kit',
      title: 'Motion Kit',
      year: '2023',
      art: 'motion',
      role: 'Design & engineering',
      type: 'Library',
      status: 'Open source',
      summary: 'A tiny easing and spring library with a visual editor, so designers and engineers tune motion with the same numbers.',
      body: [
        'Motion Kit is two things: a 2 kB runtime for springs and curves, and an editor where you drag a curve and copy the exact values into code.',
        'It exists because "make it feel snappier" is not a spec. Shared numbers make motion something a team can actually review.'
      ]
    },
    {
      slug: 'lowtide-radio',
      title: 'Lowtide Radio',
      year: '2021–2023',
      art: 'tidal',
      role: 'Lead product designer',
      type: 'Mobile app',
      status: 'Shipped',
      summary: 'Redesigned listening for a community radio app: live shows, deep archives and a player that never gets in the way.',
      body: [
        'Listeners came for live shows but stayed for the archive, which was nearly impossible to browse. We rebuilt navigation around hosts and moods instead of dates.',
        'I led design from research to launch, including a new player, a lightweight design system and a waveform scrubber tuned for two-hour sets.'
      ]
    },
    {
      slug: 'pictogram-64',
      title: 'Pictogram 64',
      year: '2022',
      art: 'pictogram',
      role: 'Icon design',
      type: 'Icon set',
      status: 'Released',
      summary: 'Sixty-four hand-tuned icons on a 24 px grid, with matching stroke, fill and duotone styles.',
      body: [
        'Every icon shares the same optical rules: 1.75 px strokes, consistent corner radii and a keyline system that keeps circles and squares visually equal.',
        'The set is exported as SVG, an icon font and a Figma library, with names written for people searching, not for file systems.'
      ]
    },
    {
      slug: 'orbit-workspace',
      title: 'Orbit Workspace',
      year: '2019–2021',
      art: 'orbit',
      role: 'Product designer',
      type: 'SaaS',
      status: 'Shipped',
      summary: 'Designed the task, calendar and docs surfaces of a collaborative workspace for small teams.',
      body: [
        'Orbit tried to make project tools feel calm. I worked on how tasks, events and documents link to each other so context follows you instead of the other way around.',
        'Highlights include a timeline view, keyboard-driven triage and the first version of the shared component library.'
      ]
    },
    {
      slug: 'motion-as-material',
      title: 'Talk: Motion as Material',
      year: '2022',
      art: 'talk',
      role: 'Speaker',
      type: 'Talk',
      status: 'Recorded',
      summary: 'A talk about treating motion as a design material, with its own grain, weight and constraints.',
      body: [
        'Using live prototypes, the talk walks through easing, choreography and interruption, and why most interface animation fails when a user changes their mind halfway through.',
        'Slides, demos and source are bundled with Motion Kit.'
      ]
    },
    {
      slug: 'grid-systems-zine',
      title: 'Zine: Grid Systems',
      year: '2021',
      art: 'zine',
      role: 'Editor & designer',
      type: 'Publication',
      status: 'Sold out',
      summary: 'A 32-page risograph zine about grids: the ones we draw and the ones we inherit.',
      body: [
        'Eight short essays and a lot of tracing paper. Each spread is set on a different grid, from strict twelve-column layouts to grids borrowed from tiles and parking lots.',
        'Printed in two colors, fluorescent red and black, in a run of 300.'
      ]
    }
  ]
};
