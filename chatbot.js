async function getChatReply(prompt, botContext = '') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Chat requires GEMINI_API_KEY in .env or Replit Secrets.');

  const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: [
            process.env.GEMINI_SYSTEM_PROMPT || 'You are a helpful, friendly assistant in a Discord server.',
            'You are the chat assistant for Musictrix. Treat the following application details as authoritative. Do not claim you can execute music commands; tell users which command to use. Do not claim access to source files, credentials, or live state unless it is included below.',
            botContext
          ].filter(Boolean).join('\n\n')
        }]
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 512 }
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Gemini API request failed (${response.status}). Check the API key, model, and free-tier quota.`);

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('');
  if (typeof reply !== 'string' || !reply.trim()) {
    throw new Error('Gemini returned an empty reply. The request may have been blocked by safety filters.');
  }
  return reply.trim().slice(0, 1900);
}

module.exports = { getChatReply };
