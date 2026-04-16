function repeatTextToLength(text, length) {
  if (!text || length <= 0) return "";

  let output = "";
  while (output.length < length) {
    output += text;
  }
  return output.slice(0, length);
}

export function createTextQueueController(textarea) {
  let cursor = 0;

  const normalizeCursor = () => {
    const text = textarea.value ?? "";
    if (cursor > text.length) cursor = text.length;
  };

  textarea.addEventListener("input", normalizeCursor);

  const consume = (count, loopEnabled) => {
    const text = textarea.value ?? "";
    if (!text || count <= 0) return "";

    if (loopEnabled) {
      return repeatTextToLength(text, count);
    }

    if (cursor >= text.length) return "";
    const next = text.slice(cursor, cursor + count);
    cursor += next.length;
    return next;
  };

  const reset = () => {
    cursor = 0;
  };

  return {
    consume,
    reset,
  };
}
