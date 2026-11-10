// A short, standard blocklist of slurs for lab notes and temperaments, base64-encoded so the words never appear in
// logs, diffs or test names. Matched as whole words (plurals too) on every spelling the guard folds (guard.mjs), and the
// longer ones also inside text squeezed of spaces and symbols. The reason given is only "abusive language".
const ENCODED = "WyJuaWdnZXIiLCJuaWdnYSIsIm5pZ2dlcnMiLCJmYWdnb3QiLCJmYWciLCJkeWtlIiwidHJhbm55IiwicmV0YXJkIiwicmV0YXJkZWQiLCJzcGljIiwiY2hpbmsiLCJnb29rIiwia2lrZSIsIndldGJhY2siLCJjb29uIiwicGFraSIsInJhZ2hlYWQiLCJ0b3dlbGhlYWQiLCJiZWFuZXIiLCJjcmFja2VyIiwid2hvcmUiLCJzbHV0IiwiY3VudCIsInR3YXQiLCJzaGVtYWxlIiwiZ3lwIiwiZ3lwc3kiLCJqYXAiLCJuZWdybyIsInNhbWJvIiwiemlwcGVyaGVhZCIsImtyYXV0Iiwid29wIiwiZGFnbyIsImNoYXYiLCJzcGF6IiwibW9uZyIsIm1vbmdvbG9pZCIsInBvcmNobW9ua2V5IiwianVuZ2xlYnVubnkiXQ==";
export const SLURS = JSON.parse(Buffer.from(ENCODED, "base64").toString("utf8"));
