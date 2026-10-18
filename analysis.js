// 장면 분석 · Superpowers 기획(Plan) 및 자동 AI 비주얼 이미지 생성 모듈
const fs = require('fs');
const path = require('path');
const os = require('os');

const MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'};

async function analyzeSingleScene({apiKey, model, scene, index, total, lang = 'ko'}) {
  const isEn = lang === 'en';
  const PROMPT = isEn ? [
    'You are a professional Shorts and Reels scriptwriter and visual storytelling director.',
    'Carefully observe the attached photo or video capture frame.',
    '- If fashion/person: focus on garments, colors, fit, posture, expression, styling points.',
    '- If scenery/travel/nature/architecture/food/daily: describe concrete visual features and aesthetic atmosphere.',
    '[Strict 1-Line Rule] The narration MUST be a single, punchy, elegant sentence in English (8-14 words max) that comfortably fits in one line on smartphone subtitles.',
    'Never write multiple sentences or long compound clauses. Keep it concise, engaging, and memorable.',
    'Never use brackets ([ ] or { }).',
    'Never use generic clichés like "a warm story" or "a new beginning". Focus on actual visible subjects.',
    'Pick 1-2 punchy words from your narration as the highlighted keyword (in English).',
    'Recommend 1 matching sound effect (sfx: whoosh, ding, vineBoom, mouseClick, pageTurn).',
    'Reply strictly in this JSON format:',
    '{"narration":"A stylish outfit with emerald accents and tailored fit!","keyword":"Emerald Accents","sfx":"whoosh"}'
  ].join(' ') : [
    '당신은 조회수 100만 쇼츠/릴스 전문 대본 작가이자 비주얼 스토리텔링 디렉터입니다.',
    '첨부된 사진 또는 영상 캡처 프레임을 자세히 관찰하세요.',
    '- 인물/패션 장면이라면: 의상(아우터, 상의, 색상, 핏), 포즈, 표정, 스타일링 포인트를 구체적으로 포착하세요.',
    '- 풍경/사찰/여행/자연/건축/음식/일상 영상이라면: 눈앞에 보이는 장소의 구체적인 특징(예: 화려한 사찰 단청과 종각, 고즈넉한 숲속 석불상, 정갈한 창살과 햇살, 먹음직스러운 요리 등)과 현장 분위기를 생생하고 품격 있게 묘사하세요.',
    '[한 줄 절대 수칙] 나레이션은 반드시 스마트폰 화면 하단 자막에서 단 한 줄(1줄)로 끝나는 짧고 감각적인 1문장(공백 포함 15~22자 내외)으로 작성하세요.',
    '두 문장 이상 쓰거나 쉼표로 길게 늘어지는 문장은 절대 금지하며, 쇼츠 화면 자막이 한 줄에 쏙 들어가도록 컴팩트하게 압축하세요.',
    '절대 대괄호([ ])나 중괄호({ })는 쓰지 마세요.',
    '"정겨운 이야기", "따뜻한 감동", "새로운 시작", "감사합니다" 같은 진부하거나 엉뚱한 문장은 절대 금지하고, 화면에 실제로 보이는 대상을 직관적으로 언급하세요.',
    '자막으로 강조할 핵심 단어 1개(keyword)를 고르고 narration 안에도 포함하세요.',
    '장면에 어울리는 효과음(sfx: whoosh, ding, vineBoom, mouseClick, pageTurn 중 택1)을 추천하세요.',
    '반드시 아래 JSON 형식으로 답하세요:',
    '{"narration":"화면 특징을 살린 짧은 1줄 문장.","keyword":"핵심단어","sfx":"whoosh"}'
  ].join(' ');

  if (!scene.image || scene.image.startsWith('bg:') || !fs.existsSync(scene.image)) {
    return {
      narration: (scene.narration || scene.title || (isEn ? `Scene ${index + 1} captivating moment.` : `장면 ${index + 1}의 멋진 순간입니다.`)).replace(/[\[\]\{\}]/g, '').trim(),
      keyword: isEn ? 'Captivating' : '멋진 순간',
      sfx: 'whoosh',
      tag: ''
    };
  }

  const ext = path.extname(scene.image).toLowerCase();
  const data = fs.readFileSync(scene.image).toString('base64');
  const mimeType = MIME[ext] || 'image/jpeg';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [{
        parts: [
          {text: PROMPT},
          {inline_data: {mime_type: mimeType, data}}
        ]
      }],
      generationConfig: {response_mime_type: 'application/json'},
    }),
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`AI 분석 오류 (${res.status}): ${body}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  let item = JSON.parse(text);
  if (Array.isArray(item)) item = item[0] || {};

  let kw = (item.keyword || '').replace(/[\[\]\{\}]/g, '').trim();
  if (kw.includes(',')) kw = kw.split(',')[0].trim();
  const kwWords = kw.split(/\s+/).filter(Boolean);
  if (kwWords.length > 3) kw = kwWords.slice(0, 2).join(' ');

  let narr = (item.narration || '').replace(/[\[\]\{\}]/g, '').replace(/\s+/g, ' ').trim();
  if (narr.includes('.')) {
    const sents = narr.split(/[.?!]/).map((s) => s.trim()).filter(Boolean);
    if (sents.length > 0 && sents[0].length >= 8) {
      narr = sents[0] + (narr.includes('?') ? '?' : '!');
    }
  }

  return {
    narration: narr,
    keyword: kw || (isEn ? 'Highlight' : '하이라이트'),
    sfx: item.sfx || 'whoosh',
    tag: '',
  };
}

async function analyzeCohesiveStory({apiKey, model, scenes, lang = 'ko'}) {
  const isEn = lang === 'en';
  const parts = [
    {
      text: isEn ? [
        'You are an expert Shorts and Reels storyboard director.',
        `Carefully review all ${scenes.length} scenes (photos or video frames) in sequence, and construct a cohesive, engaging Shorts narrative arc across all scenes.`,
        '- If fashion/person: highlight outfit synergy, color coordination, and styling confidence.',
        '- If scenery/travel/nature/daily: describe concrete visual details, atmosphere, and charm.',
        '- Scene 1 (The Hook): A captivating opening question or remark that grabs viewer attention within 3 seconds.',
        '- Middle scenes (The Journey): Highlight specific visual features in each scene to flow the story seamlessly.',
        `- Scene ${scenes.length} (The Punchline): A memorable, punchy closing line that leaves a lasting impression.`,
        '[Strict 1-Line Rule] Each scene narration MUST be a single, punchy, elegant English sentence (8-14 words max) designed for 1-line mobile subtitles.',
        'Never write multiple sentences or long compound clauses. Keep it concise, engaging, and memorable.',
        'Never use brackets ([ ] or { }).',
        'Never use generic clichés like "a warm story" or "a new beginning". Focus on actual visible subjects.',
        'For each scene, recommend 1 highlighted keyword (1-2 words in English) and 1 matching sound effect (sfx: whoosh, ding, vineBoom, mouseClick, pageTurn).',
        'Reply strictly in this JSON array format:',
        '[{"narration":"A stylish outfit with emerald accents and tailored fit!","keyword":"Emerald Accents","sfx":"whoosh"}]'
      ].join(' ') : [
        '당신은 Vrew 스타일의 조회수 100만 숏폼/릴스 전문 스토리보드 디렉터입니다.',
        `첨부된 총 ${scenes.length}개의 장면(사진 또는 영상 캡처 프레임)들을 순서대로 보고, 전체적으로 하나의 유기적이고 완성도 높은 숏폼 스토리(스토리보드)를 작성하세요.`,
        '- 인물/패션이면 코디와 스타일의 매력을, 사찰/여행/자연/일상/음식 영상이면 눈앞에 펼쳐진 풍경과 건축물, 공간의 정취를 생생하게 묘사하세요.',
        '- 1번 장면 (후킹): 시청자의 시선을 3초 안에 사로잡는 감성적인 오프닝이나 질문과 함께 1번 장면의 특징 소개.',
        '- 중간 장면들 (전개): 각 장면의 실제 시각적 요소(단청, 불상, 숲길, 창살, 의상, 요리 등)를 구체적으로 짚어주며 자연스럽게 이야기를 연결.',
        `- ${scenes.length}번 장면 (마무리): 전체 여정이나 스타일을 아우르는 여운 있는 마무리 한 줄.`,
        '[한 줄 절대 수칙] 각 장면마다 스마트폰 화면 하단 자막에서 단 한 줄(1줄)로 끝나는 짧고 감각적인 1문장(공백 포함 15~22자 내외)의 한국어 나레이션(narration)을 작성하세요.',
        '두 문장 이상 쓰거나 쉼표로 길게 늘어지는 복문은 절대 금지하며, 자막이 두 줄로 넘어가지 않도록 강력하게 압축하세요.',
        '절대 대괄호([ ])나 중괄호({ })는 쓰지 마세요.',
        '"정겨운 이야기", "따뜻한 감동", "새로운 시작", "감사합니다" 같은 뻔한 문장은 절대 금지하며, 각 화면에 실제로 보이는 구체적인 피사체와 색감을 언급하세요.',
        '각 장면마다 자막으로 강조할 핵심 단어 1개(keyword), 효과음(sfx: whoosh, ding, vineBoom, mouseClick, pageTurn 중 택1)을 추천하세요.',
        '반드시 아래 JSON 배열 형식으로만 답하세요:',
        '[{"narration":"한 줄로 끝나는 짧은 문장.","keyword":"핵심단어","sfx":"whoosh"}]'
      ].join(' ')
    }
  ];

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (s.image && !s.image.startsWith('bg:') && fs.existsSync(s.image)) {
      const ext = path.extname(s.image).toLowerCase();
      const data = fs.readFileSync(s.image).toString('base64');
      const mimeType = MIME[ext] || 'image/jpeg';
      parts.push({
        inline_data: {mime_type: mimeType, data}
      });
    }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts}],
      generationConfig: {response_mime_type: 'application/json'}
    })
  });

  if (!res.ok) throw new Error(`AI 스토리 생성 오류 (${res.status})`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const arr = JSON.parse(text);
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('응답 형식 오류');

  return arr.map((item, idx) => {
    let kw = (item.keyword || '').replace(/[\[\]\{\}]/g, '').trim();
    if (kw.includes(',')) kw = kw.split(',')[0].trim();
    const kwWords = kw.split(/\s+/).filter(Boolean);
    if (kwWords.length > 3) kw = kwWords.slice(0, 2).join(' ');

    const validSfx = ['whoosh', 'ding', 'vineBoom', 'mouseClick', 'pageTurn'];
    const sfxVal = validSfx.includes(item.sfx) ? item.sfx : 'whoosh';

    let narr = (item.narration || '').replace(/[\[\]\{\}]/g, '').replace(/\s+/g, ' ').trim();
    if (narr.includes('.')) {
      const sents = narr.split(/[.?!]/).map((s) => s.trim()).filter(Boolean);
      if (sents.length > 0 && sents[0].length >= 8) {
        narr = sents[0] + (narr.includes('?') ? '?' : '!');
      }
    }

    return {
      narration: narr,
      keyword: kw || '하이라이트',
      sfx: sfxVal,
      tag: '',
    };
  });
}

async function analyzeScenes({apiKey, model, scenes, lang = 'ko'}) {
  const targetScenes = Array.isArray(scenes) ? scenes : [];
  if (!targetScenes.length) return [];
  const isEn = lang === 'en';

  if (targetScenes.length > 1) {
    try {
      const storyResults = await analyzeCohesiveStory({apiKey, model, scenes: targetScenes, lang});
      if (storyResults && storyResults.length >= targetScenes.length) {
        return storyResults.slice(0, targetScenes.length);
      }
    } catch (e) {
      console.warn('유기적 스토리 생성 실패, 개별 병렬 분석으로 대체:', e.message);
    }
  }

  const results = await Promise.all(
    targetScenes.map((s, idx) => analyzeSingleScene({
      apiKey,
      model,
      scene: s,
      index: idx,
      total: targetScenes.length,
      lang,
    }).catch((err) => {
      console.warn(`장면 ${idx + 1} 개별 분석 오류:`, err.message);
      return {
        narration: (s.narration || s.title || (isEn ? `Scene ${idx + 1} captivating visual moment!` : `장면 ${idx + 1}의 시선을 사로잡는 비주얼입니다.`)).replace(/[\[\]\{\}]/g, '').trim(),
        keyword: isEn ? 'Captivating' : '시선 집중',
        sfx: 'whoosh',
        tag: '',
      };
    }))
  );
  return results;
}

async function generateSceneImage({apiKey, prompt, aspect = '9:16', outDir, index}) {
  const aspectDesc = aspect === '16:9'
    ? '16:9 cinematic wide horizontal landscape wallpaper'
    : aspect === '1:1'
      ? '1:1 square balanced composition art'
      : 'vertical 9:16 portrait orientation smartphone wallpaper';

  const fullPrompt = [
    `High-end ${aspectDesc}, 8k resolution, photorealistic, dramatic studio lighting, rich vibrant colors, highly detailed, masterwork digital illustration, no text, no watermark, no captions.`,
    `Visual description: ${prompt}`
  ].join(' ');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts: [{text: fullPrompt}]}],
      generationConfig: {
        responseModalities: ['IMAGE'],
      },
    }),
  });

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300);
    throw new Error(`이미지 생성 API 오류 (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.[0];
  if (!part?.inlineData?.data) {
    throw new Error('AI 이미지 데이터 반환 실패');
  }

  fs.mkdirSync(outDir, {recursive: true});
  const filePath = path.join(outDir, `ai-scene-${Date.now()}-${index}.png`);
  fs.writeFileSync(filePath, Buffer.from(part.inlineData.data, 'base64'));
  return filePath;
}

async function planSuperpowersProject({apiKey, model = 'gemini-2.5-flash', topic, aspect = '9:16', onProgress}) {
  return [];
}

async function regenerateSceneImage({apiKey, narration, prompt, aspect = '9:16'}) {
  const imgDir = path.join(os.tmpdir(), 'video-agent-ai-images');
  let finalPrompt = prompt || `${narration}, high-end cinematic 8k digital art`;
  return generateSceneImage({
    apiKey,
    prompt: finalPrompt,
    aspect,
    outDir: imgDir,
    index: Date.now() % 10000,
  });
}

module.exports = {analyzeScenes, generateSceneImage, planSuperpowersProject, regenerateSceneImage};

