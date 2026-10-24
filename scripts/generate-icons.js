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
      background: transparent;
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

// Reusable SVG defs matching StudICILogo.tsx exactly
const svgDefs = `
  <defs>
    <linearGradient id="logoBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#822433" stop-opacity="1" />
      <stop offset="100%" stop-color="#4c0519" stop-opacity="1" />
    </linearGradient>

    <linearGradient id="logoGlyphGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#fecdd3" />
    </linearGradient>

    <linearGradient id="logoAccentGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#f59e0b" />
    </linearGradient>
  </defs>
`;

// Reusable emblem group matching StudICILogo.tsx withBackground transform
const emblemGroup = `
  <g transform="scale(0.82) translate(13, 13)">
    <path
      d="M 34,46 C 34,31 46,24 60,24 C 76,24 86,34 86,47 C 86,60 74,65 60,68 C 44,71 34,76 34,88 C 34,101 46,108 60,108 C 76,108 86,99 86,84"
      fill="none"
      stroke="url(#logoGlyphGrad)"
      stroke-width="8.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <path
      d="M 60,40 L 60,82"
      fill="none"
      stroke="rgba(255, 255, 255, 0.95)"
      stroke-width="6.5"
      stroke-linecap="round"
    />

    <circle
      cx="60"
      cy="24"
      r="4"
      fill="url(#logoAccentGrad)"
    />

    <circle
      cx="86"
      cy="84"
      r="3.5"
      fill="#fecdd3"
    />
  </g>
`;

// 1. Full 1024x1024 App Icon (iOS & Expo main icon)
// Square background (no pre-rounded corners, matching Apple HIG guidelines)
const icon1024Svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 120 120">
  ${svgDefs}
  <rect x="0" y="0" width="120" height="120" fill="url(#logoBgGrad)" />
  ${emblemGroup}
</svg>
`;

// 2. Android Adaptive Icon Background (512x512)
const androidBgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 120 120">
  ${svgDefs}
  <rect x="0" y="0" width="120" height="120" fill="url(#logoBgGrad)" />
</svg>
`;

// 3. Android Adaptive Icon Foreground (512x512 transparent)
const androidFgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 120 120">
  ${svgDefs}
  ${emblemGroup}
</svg>
`;

// 4. Android Monochrome Icon (432x432 transparent white)
const androidMonoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 120 120">
  <g transform="scale(0.82) translate(13, 13)">
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

// 5. Favicon (48x48) with squircle
const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 120 120">
  ${svgDefs}
  <rect x="0" y="0" width="120" height="120" rx="28" ry="28" fill="url(#logoBgGrad)" />
  ${emblemGroup}
</svg>
`;

// 6. Splash Icon (256x256)
const splashIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 120 120">
  ${svgDefs}
  <rect x="0" y="0" width="120" height="120" rx="28" ry="28" fill="url(#logoBgGrad)" />
  ${emblemGroup}
</svg>
`;

console.log('Generating assets from SVG logo...');
renderSvgToPng(icon1024Svg, 'assets/images/icon.png', 1024, 1024, false);
renderSvgToPng(androidBgSvg, 'assets/images/android-icon-background.png', 512, 512, false);
renderSvgToPng(androidFgSvg, 'assets/images/android-icon-foreground.png', 512, 512, true);
renderSvgToPng(androidMonoSvg, 'assets/images/android-icon-monochrome.png', 432, 432, true);
renderSvgToPng(faviconSvg, 'assets/images/favicon.png', 48, 48, true);
renderSvgToPng(splashIconSvg, 'assets/images/splash-icon.png', 256, 256, true);
console.log('All icons generated successfully!');
