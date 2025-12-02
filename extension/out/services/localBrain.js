"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkLocalBrain = checkLocalBrain;
function checkLocalBrain(prompt) {
    const lowerPrompt = prompt.toLowerCase().trim();
    const greetings = ["hi", "hello", "hey", "hii", "hiii", "sup", "thanks", "thank you", "good morning", "good evening", "what's up", "yo"];
    if (greetings.some(g => lowerPrompt.includes(g)) || lowerPrompt.length < 25) {
        return {
            reasoning: "Hey! I'm Platypus — your senior dev pair programmer. Tell me what you want to build or fix — I can create files, refactor, fix bugs, anything.",
            changes: []
        };
    }
    return null;
}
//# sourceMappingURL=localBrain.js.map