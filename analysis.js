// 장면 분석과 자동 대본: 이미지들을 비전 모델에 보내 장면별 나레이션 초안을 받는다.
const fs = require('fs');
const path = require('path');

const MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'};

const PROMPT = [
  '당신은 짧은 정보형 영상의 대본 작가입니다.',
  '첨부된 이미지들을 순서대로 보고, 각 이미지에 대해 한국어 나레이션을 두 문장으로 작성하세요.',
  '과장하지 말고 이미지에 적힌 핵심 정보를 자연스럽게 풀어 쓰세요.',
  '각 장면에서 자막으로 강조하면 좋을 핵심 단어나 구를 하나 골라 narration 안에 그대로 포함하세요.',
  '반드시 아래 JSON 배열 형식으로만 답하고 다른 글은 쓰지 마세요.',
  '[{"narration":"문장1. 문장2.","keyword":"강조할 구"}]',
].join(' ');

async function analyzeScenes({apiKey, model, scenes}) {
  const parts = [{text: PROMPT}];
  for (const s of scenes) {
    const ext = path.extname(s.image).toLowerCase();
    const data = fs.readFileSync(s.image).toString('base64');
    parts.push({inline_data: {mime_type: MIME[ext] || 'image/jpeg', data}});
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts}],
      generationConfig: {response_mime_type: 'application/json'},
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`AI 분석 오류 (${res.status}): ${body}`);
  }
  const json = await res.json();
  const text = json.candidates[0].content.parts.map((p) => p.text || '').join('');
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error('AI 응답 형식이 예상과 다릅니다.');
  return arr;
}

module.exports = {analyzeScenes};
