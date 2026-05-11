<script lang="ts">
  let { width = 1200, height = 630 }: { width?: number; height?: number } = $props();
</script>

<defs>
  <linearGradient id="field-vignette" x1="0" x2="1" y1="0" y2="1">
    <stop offset="0%" stop-color="#0f1e33" />
    <stop offset="52%" stop-color="#050712" />
    <stop offset="100%" stop-color="#0a1628" />
  </linearGradient>
  <radialGradient id="field-soft-light" cx="38%" cy="32%" r="68%">
    <stop offset="0%" stop-color="rgba(83,102,242,0.14)" />
    <stop offset="54%" stop-color="rgba(0,196,255,0.035)" />
    <stop offset="100%" stop-color="rgba(0,196,255,0)" />
  </radialGradient>
  <pattern id="field-dots" width="28" height="28" patternUnits="userSpaceOnUse">
    <circle cx="1.5" cy="1.5" r="1.1" fill="rgba(148,163,184,0.26)" />
  </pattern>
</defs>

<rect {width} {height} fill="url(#field-vignette)" />
<rect {width} {height} fill="url(#field-soft-light)" opacity="0.75" />
<rect {width} {height} fill="url(#field-dots)" opacity="0.24" />
<rect x="14" y="14" width={width - 28} height={height - 28} fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5" rx="24" />
