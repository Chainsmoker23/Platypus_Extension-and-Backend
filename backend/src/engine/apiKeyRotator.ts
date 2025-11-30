
const rawKeys = process.env.GEMINI_KEYS;
const singleKey = process.env.API_KEY;

// Support both GEMINI_KEYS list and legacy API_KEY
const API_KEYS = rawKeys 
  ? rawKeys.split(',').map(k => k.trim()).filter(k => k) 
  : (singleKey ? [singleKey] : []);

let currentIndex = 0;

export function getNextValidKey(): string | null {
  if (API_KEYS.length === 0) return null;

  const key = API_KEYS[currentIndex];
  currentIndex = (currentIndex + 1) % API_KEYS.length;
  return key;
}

export async function withRotatingKey<T>(
  operation: (key: string) => Promise<T>
): Promise<T> {
  let lastError;

  // If we have keys, try looping through them. If not, try once (will fail in getNextValidKey)
  const maxAttempts = API_KEYS.length > 0 ? API_KEYS.length : 1;

  for (let i = 0; i < maxAttempts; i++) {
    const key = getNextValidKey();
    if (!key) throw new Error("No API keys configured. Set GEMINI_KEYS or API_KEY in .env");

    try {
      // Optional: override process.env for libraries that might use it implicitly
      process.env.API_KEY = key; 
      
      // Log rotation usage (1-based index for readability)
      // current index is already advanced, so (currentIndex === 0 ? length : currentIndex)
      const visibleIndex = currentIndex === 0 ? API_KEYS.length : currentIndex;
      if (API_KEYS.length > 1) {
          console.log(`[KeyRotator] Using key ${visibleIndex}/${API_KEYS.length}`);
      }

      return await operation(key);
    } catch (error: any) {
      lastError = error;
      const msg = (error.message || "").toLowerCase();
      const status = error.status || 0;

      // Log failure but mask key
      console.warn(`[KeyRotator] Key ending in ...${key.slice(-4)} failed: ${msg}`);

      // Check for rotation conditions
      if (
          msg.includes("429") || 
          msg.includes("quota") || 
          msg.includes("limit") || 
          msg.includes("invalid") || // invalid key
          status === 429 || 
          status === 401 ||
          status === 403
      ) {
        continue; // try next key
      }
      
      throw error; // real error, not quota/auth related
    }
  }

  throw lastError || new Error("All API keys exhausted");
}
