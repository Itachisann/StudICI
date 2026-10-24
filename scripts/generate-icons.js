const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

console.log('Using browser:', CHROME_PATH);

function renderSvgToPng(svgMarkup, outputPath, width, height, transparent = false) {
  const tempHtmlPath = path.resolve(__dirname, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.html`);
  const finalHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: ${transparent ? 'transparent' : '#0d0e12'};
    }
    svg {
      display: block;
      width: ${width}px;
      height: ${height}px;
    }
  </style>
</head>
<body>
  ${svgMarkup}
</body>
</html>`;

  fs.writeFileSync(tempHtmlPath, finalHtml, 'utf8');

  const fileUrl = 'file:///' + tempHtmlPath.replace(/\\/g, '/');
  const resolvedOut = path.resolve(outputPath);

  const args = [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
  ];

  if (transparent) {
    args.push('--default-background-color=00000000');
  }

  args.push(`--screenshot=${resolvedOut}`, fileUrl);

  try {
    execFileSync(CHROME_PATH, args, { stdio: 'pipe' });
    console.log(`Rendered: ${outputPath} (${width}x${height})`);
  } finally {
    if (fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
  }
}

// Gradient definitions matching the multi-color variant of first startup ("la variante al primo avvio")
// Spiral: rich Sapienza crimson (#be123c / #822433) fading into elegant silver (#a1a1aa / #e4e4e7)
// Column: vibrant Sapienza crimson
// Cuspide: bright glowing gold (#fbbf24 -> #f59e0b)
// Bottom dot: silver (#e4e4e7)
const colorDefs = `
  <defs>
    <!-- Background Halo Glow (like cleanLogoGlow from first startup) -->
    <radialGradient id="haloGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#be123c" stop-opacity="0.48" />
      <stop offset="35%" stop-color="#822433" stop-opacity="0.32" />
      <stop offset="65%" stop-color="#822433" stop-opacity="0.12" />
      <stop offset="100%" stop-color="#0d0e12" stop-opacity="0" />
    </radialGradient>

    <!-- Spiral Gradient (Crimson to Silver) -->
    <linearGradient id="spiralGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e11d48" />
      <stop offset="35%" stop-color="#be123c" />
      <stop offset="70%" stop-color="#991b1b" />
      <stop offset="88%" stop-color="#cbd5e1" />
      <stop offset="100%" stop-color="#f1f5f9" />
    </linearGradient>

    <!-- Column Gradient (Sapienza Crimson) -->
    <linearGradient id="columnGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f43f5e" />
      <stop offset="100%" stop-color="#9f1239" />
    </linearGradient>

    <!-- Cuspide Gold Accent -->
    <linearGradient id="goldCuspideGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fde047" />
      <stop offset="40%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
  </defs>
`;

// Helper to generate emblem markup with EXACT geometric centering
// Raw bounds: X in [29.75, 90.25] (center 60.0), Y in [19.75, 112.25] (center 66.0)
// To center at (cx, cy) with scale S: translate(cx, cy) scale(S) translate(-60, -66)
function generateEmblemMarkup(cx, cy, scale) {
  return `
    <g transform="translate(${cx}, ${cy}) scale(${scale}) translate(-60, -66)">
      <!-- Spirale / S-Curve continua ed elegante -->
      <path
        d="M 34,46 C 34,31 46,24 60,24 C 76,24 86,34 86,47 C 86,60 74,65 60,68 C 44,71 34,76 34,88 C 34,101 46,108 60,108 C 76,108 86,99 86,84"
        fill="none"
        stroke="url(#spiralGrad)"
        stroke-width="8.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- Colonna verticale (la 'I' centrale) -->
      <path
        d="M 60,40 L 60,82"
        fill="none"
        stroke="url(#columnGrad)"
        stroke-width="6.5"
        stroke-linecap="round"
      />

      <!-- Cuspide di Sant'Ivo in oro -->
      <circle
        cx="60"
        cy="24"
        r="4"
        fill="url(#goldCuspideGrad)"
      />

      <!-- Accento alla base in argento -->
      <circle
        cx="86"
        cy="84"
        r="3.5"
        fill="#e2e8f0"
      />
    </g>
  `;
}

// 1. Full 1024x1024 App Icon (iOS & Expo main icon)
// Background: #0d0e12 with red radial halo, exactly centered emblem
// Scale 6.4: width 387.2px, height 592px, left/right margin 318.4px, top/bottom margin 216px
const icon1024Svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${colorDefs}
  <!-- Dark background -->
  <rect width="1024" height="1024" fill="#0d0e12" />

  <!-- Glowing red halo behind the logo -->
  <circle cx="512" cy="512" r="470" fill="url(#haloGlow)" />

  <!-- Multi-colored emblem perfectly centered -->
  ${generateEmblemMarkup(512, 512, 6.4)}
</svg>
`;

// 2. Android Adaptive Icon Background (512x512)
const androidBgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${colorDefs}
  <rect width="512" height="512" fill="#0d0e12" />
  <circle cx="256" cy="256" r="235" fill="url(#haloGlow)" />
</svg>
`;

// 3. Android Adaptive Icon Foreground (512x512 transparent)
// Android adaptive safe area is inner 66% (338px diameter).
// Scale 3.2: height 296px, width 193.6px. Fits comfortably in safe circle.
const androidFgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${colorDefs}
  ${generateEmblemMarkup(256, 256, 3.2)}
</svg>
`;

// 4. Android Monochrome Icon (432x432 transparent white)
const androidMonoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 432 432">
  <g transform="translate(216, 216) scale(2.7) translate(-60, -66)">
    <path
      d="M 34,46 C 34,31 46,24 60,24 C 76,24 86,34 86,47 C 86,60 74,65 60,68 C 44,71 34,76 34,88 C 34,101 46,108 60,108 C 76,108 86,99 86,84"
      fill="none"
      stroke="#ffffff"
      stroke-width="8.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M 60,40 L 60,82"
      fill="none"
      stroke="#ffffff"
      stroke-width="6.5"
      stroke-linecap="round"
    />
    <circle cx="60" cy="24" r="4" fill="#ffffff" />
    <circle cx="86" cy="84" r="3.5" fill="#ffffff" />
  </g>
</svg>
`;

// 5. Favicon (48x48)
const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  ${colorDefs}
  <rect width="48" height="48" rx="10" ry="10" fill="#0d0e12" />
  <circle cx="24" cy="24" r="22" fill="url(#haloGlow)" />
  ${generateEmblemMarkup(24, 24, 0.36)}
</svg>
`;

// 6. Splash Icon (256x256)
const splashIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  ${colorDefs}
  <circle cx="128" cy="128" r="120" fill="url(#haloGlow)" />
  ${generateEmblemMarkup(128, 128, 1.8)}
</svg>
`;

console.log('Generating assets with colored first-startup variant & perfect centering...');
renderSvgToPng(icon1024Svg, 'assets/images/icon.png', 1024, 1024, false);
renderSvgToPng(androidBgSvg, 'assets/images/android-icon-background.png', 512, 512, false);
renderSvgToPng(androidFgSvg, 'assets/images/android-icon-foreground.png', 512, 512, true);
renderSvgToPng(androidMonoSvg, 'assets/images/android-icon-monochrome.png', 432, 432, true);
renderSvgToPng(faviconSvg, 'assets/images/favicon.png', 48, 48, true);
renderSvgToPng(splashIconSvg, 'assets/images/splash-icon.png', 256, 256, true);
console.log('All icons generated successfully with first-startup styling and perfect centering!');
