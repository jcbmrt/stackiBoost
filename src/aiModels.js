// which ai models the user has added, shared by chat + settings

export const getAiModels = () => {
  try {
    const v = JSON.parse(localStorage.getItem('ai-models'));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

export const setAiModels = (ids) => {
  localStorage.setItem('ai-models', JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent('ai-models-changed'));
};
