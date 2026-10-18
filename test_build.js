const path = require('path');
const fs = require('fs');
const {buildProject} = require('./engine');

async function test() {
  const workDir = '/tmp/test_studio_run';
  const outDir = '/tmp/test_studio_out';
  fs.mkdirSync(workDir, {recursive: true});
  fs.mkdirSync(outDir, {recursive: true});

  const testImg = '/private/tmp/test_orient6.jpg'; // EXIF orientation 6 (smartphone vertical)
  const outputPath = path.join(outDir, 'test_output_shorts.mp4');

  const payload = {
    scenes: [
      {
        image: testImg,
        narration: '시원한 라운지에서 즐기는 코딩!',
        keyword: '코딩',
        motion: 'zoomIn',
        sfx: 'whoosh'
      }
    ],
    keywords: ['코딩'],
    captionStyle: 'scdream',
    shadowStyle: 'deepShadow',
    aspect: '9:16',
    title: '화려한 라운지에서 | 여유로운 코딩',
    titleMode: 'fullTime',
    titleStyle: 'shadow',
    titleSize: 'large',
    titleColor: 'mintWhite',
    showTitle: true,
    showSubtitles: true,
    outputMode: 'both',
    workDir,
    outputPath,
    fontsDir: '/Applications/Video Agent Studio.app/Contents/Resources/fonts',
    tts: { apiKey: '' } // fallback silent
  };

  console.log('Starting test build...');
  const res = await buildProject(payload, (stage, cur, total) => {
    console.log(`[Progress] ${stage} ${cur}/${total}`);
  });
  console.log('Result:', res);
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
