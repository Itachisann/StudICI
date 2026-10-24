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
      background: ${transparent ? 'transparent' : '#822433'};
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

// Visual definitions:
// - Red background (#822433 to #4c0519)
// - Bold, crisp pure white vertical column ("I") so it never blends in or disappears
// - Multi-tone spiral: luminous silver-white with subtle warm gold/champagne transitions
// - Cuspide of Sant'Ivo: bright glowing gold (#fde047 to #fbbf24)
// - Bottom accent: bright gold
const visualDefs = `
  <defs>
    <!-- Rich Sapienza Red Background Gradient -->
    <linearGradient id="redBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#822433" />
      <stop offset="50%" stop-color="#691522" />
      <stop offset="100%" stop-color="#4c0519" />
    </linearGradient>

    <!-- Subtle radial depth glow in the red background -->
    <radialGradient id="depthGlow" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.12" />
      <stop offset="60%" stop-color="#000000" stop-opacity="0" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.25" />
    </radialGradient>

    <!-- Multi-tone Spiral Gradient (White to Platinum/Champagne) -->
    <linearGradient id="spiralGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="30%" stop-color="#fdf4ff" />
      <stop offset="70%" stop-color="#fef3c7" />
      <stop offset="100%" stop-color="#ffffff" />
    </linearGradient>

    <!-- Bright Gold Cuspide of Sant'Ivo -->
    <linearGradient id="goldCuspideGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="35%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
  </defs>
`;

// Helper to generate the emblem markup with exact sub-pixel geometric centering
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

      <!-- Colonna verticale (la 'I' centrale): BIANCA nitida, ben visibile, in primo piano -->
      <path
        d="M 60,40 L 60,82"
        fill="none"
        stroke="#ffffff"
        stroke-width="7.5"
        stroke-linecap="round"
      />

      <!-- Cuspide di Sant'Ivo in oro brillante -->
      <circle
        cx="60"
        cy="24"
        r="4.2"
        fill="url(#goldCuspideGrad)"
      />

      <!-- Accento alla base in oro caldo -->
      <circle
        cx="86"
        cy="84"
        r="3.6"
        fill="#fde047"
      />
    </g>
  `;
}

// 1. Full 1024x1024 App Icon (iOS & Expo main icon)
// Red background (#822433 -> #4c0519), white 'I' column clearly visible, gold accents, centered
const icon1024Svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${visualDefs}
  <!-- Full-bleed Red Gradient Background -->
  <rect width="1024" height="1024" fill="url(#redBgGrad)" />
  <rect width="1024" height="1024" fill="url(#depthGlow)" />

  <!-- Multi-colored emblem with prominent white vertical column, perfectly centered -->
  ${generateEmblemMarkup(512, 512, 6.4)}
</svg>
`;

// 2. Android Adaptive Icon Background (512x512)
const androidBgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${visualDefs}
  <rect width="512" height="512" fill="url(#redBgGrad)" />
  <rect width="512" height="512" fill="url(#depthGlow)" />
</svg>
`;

// 3. Android Adaptive Icon Foreground (512x512 transparent)
const androidFgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${visualDefs}
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
      stroke-width="7.5"
      stroke-linecap="round"
    />
    <circle cx="60" cy="24" r="4.2" fill="#ffffff" />
    <circle cx="86" cy="84" r="3.6" fill="#ffffff" />
  </g>
</svg>
`;

// 5. Favicon (48x48) with squircle
const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  ${visualDefs}
  <rect width="48" height="48" rx="10" ry="10" fill="url(#redBgGrad)" />
  ${generateEmblemMarkup(24, 24, 0.36)}
</svg>
`;

// 6. Splash Icon (256x256)
const splashIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  ${visualDefs}
  <rect width="256" height="256" rx="56" ry="56" fill="url(#redBgGrad)" />
  ${generateEmblemMarkup(128, 128, 1.8)}
</svg>
`;

console.log('Generating red background icons with prominent vertical column and perfect centering...');
renderSvgToPng(icon1024Svg, 'assets/images/icon.png', 1024, 1024, false);
renderSvgToPng(androidBgSvg, 'assets/images/android-icon-background.png', 512, 512, false);
renderSvgToPng(androidFgSvg, 'assets/images/android-icon-foreground.png', 512, 512, true);
renderSvgToPng(androidMonoSvg, 'assets/images/android-icon-monochrome.png', 432, 432, true);
renderSvgToPng(faviconSvg, 'assets/images/favicon.png', 48, 48, true);
renderSvgToPng(splashIconSvg, 'assets/images/splash-icon.png', 256, 256, true);
console.log('All icons generated successfully!');
