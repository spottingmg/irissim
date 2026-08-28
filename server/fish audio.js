// server/fish-audio.js
// Wrapper um die Fish Audio TTS-API (https://api.fish.audio/v1/tts).
// Cached generierte Ansagen auf Basis eines Hashes des Textes, damit
// wiederkehrende Saetze (gleicher Zug, gleiche Verspaetung) nicht erneut
// kostenpflichtig generiert werden.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function cacheKey(text, voiceId, model) {
  return crypto.createHash('sha256').update(`${model}|${voiceId || ''}|${text}`).digest('hex');
}

async function synthesize(text) {
  const apiKey = process.env.FISH_API_KEY;
  const model = process.env.FISH_TTS_MODEL || 's2-pro';
  const voiceId = process.env.FISH_VOICE_ID || '';

  if (!apiKey || apiKey === 'dein_fish_audio_api_key_hier') {
    throw new Error(
      'FISH_API_KEY ist nicht gesetzt. Bitte .env anlegen (siehe .env.example) und einen echten Fish-Audio-API-Key eintragen.'
    );
  }

  const key = cacheKey(text, voiceId, model);
  const cachedFile = path.join(CACHE_DIR, `${key}.mp3`);

  if (fs.existsSync(cachedFile)) {
    return fs.readFileSync(cachedFile);
  }

  const body = {
    text,
    format: 'mp3'
  };
  if (voiceId) body.reference_id = voiceId;

  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'model': model
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Fish Audio TTS Fehler (${res.status}): ${errText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(cachedFile, buffer);
  return buffer;
}

module.exports = { synthesize };
