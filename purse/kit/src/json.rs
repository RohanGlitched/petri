//! Just enough JSON: find a key in an object and take its raw value, and write values out.
//!
//! Inputs are never trusted: a malformed object reads as missing keys, and strings with escapes are refused where an
//! account or token id is expected (none can contain one).

use alloc::vec::Vec;

fn ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && matches!(b[i], b' ' | b'\n' | b'\r' | b'\t') {
        i += 1;
    }
    i
}

/// The index just past the value starting at `i`.
fn value_end(b: &[u8], i: usize) -> Option<usize> {
    let c = *b.get(i)?;
    match c {
        b'"' => {
            let mut j = i + 1;
            while j < b.len() {
                match b[j] {
                    b'\\' => j += 2,
                    b'"' => return Some(j + 1),
                    _ => j += 1,
                }
            }
            None
        }
        b'{' | b'[' => {
            let mut depth = 0usize;
            let mut j = i;
            while j < b.len() {
                match b[j] {
                    b'"' => {
                        j = value_end(b, j)?;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(j + 1);
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            None
        }
        _ => {
            let mut j = i;
            while j < b.len() && !matches!(b[j], b',' | b'}' | b']' | b' ' | b'\n' | b'\r' | b'\t') {
                j += 1;
            }
            (j > i).then_some(j)
        }
    }
}

/// Each key of the top-level object `obj` (raw, without its quotes) with its raw value, until `f` returns true. A
/// malformed object stops early.
pub fn each<'a>(obj: &'a [u8], mut f: impl FnMut(&'a [u8], &'a [u8]) -> bool) {
    let mut i = ws(obj, 0);
    if obj.get(i) != Some(&b'{') {
        return;
    }
    i += 1;
    loop {
        i = ws(obj, i);
        if obj.get(i) != Some(&b'"') {
            return;
        }
        let Some(kend) = value_end(obj, i) else { return };
        let k = &obj[i + 1..kend - 1];
        i = ws(obj, kend);
        if obj.get(i) != Some(&b':') {
            return;
        }
        i = ws(obj, i + 1);
        let Some(vend) = value_end(obj, i) else { return };
        if f(k, &obj[i..vend]) {
            return;
        }
        i = ws(obj, vend);
        if obj.get(i) != Some(&b',') {
            return;
        }
        i += 1;
    }
}

/// The raw value of `key` in the top-level object `obj` (`null` reads as missing).
pub fn get<'a>(obj: &'a [u8], key: &str) -> Option<&'a [u8]> {
    let mut i = ws(obj, 0);
    if obj.get(i) != Some(&b'{') {
        return None;
    }
    i += 1;
    loop {
        i = ws(obj, i);
        if obj.get(i)? != &b'"' {
            return None;
        }
        let kend = value_end(obj, i)?;
        let k = &obj[i + 1..kend - 1];
        i = ws(obj, kend);
        if obj.get(i)? != &b':' {
            return None;
        }
        i = ws(obj, i + 1);
        let vend = value_end(obj, i)?;
        if k == key.as_bytes() {
            let v = &obj[i..vend];
            return if v == b"null" { None } else { Some(v) };
        }
        i = ws(obj, vend);
        match obj.get(i)? {
            b',' => i += 1,
            _ => return None,
        }
    }
}

/// The contents of a JSON string with no escapes in it.
pub fn plain_str(raw: &[u8]) -> Option<&[u8]> {
    if raw.len() < 2 || raw[0] != b'"' || raw[raw.len() - 1] != b'"' {
        return None;
    }
    let inner = &raw[1..raw.len() - 1];
    (!inner.contains(&b'\\')).then_some(inner)
}

/// A whole number, written as a JSON number or a decimal string.
pub fn uint(raw: &[u8]) -> Option<u128> {
    let digits = plain_str(raw).unwrap_or(raw);
    if digits.is_empty() || digits.len() > 39 {
        return None;
    }
    let mut n: u128 = 0;
    for &c in digits {
        if !c.is_ascii_digit() {
            return None;
        }
        n = n.checked_mul(10)?.checked_add((c - b'0') as u128)?;
    }
    Some(n)
}

/// A string field that must be there.
pub fn str_arg<'a>(obj: &'a [u8], key: &str) -> &'a [u8] {
    get(obj, key).and_then(plain_str).unwrap_or_else(|| crate::fail(missing(key)))
}

fn missing(key: &str) -> &'static str {
    // No formatting machinery: one fixed message per expected key.
    match key {
        "token_id" => "token_id is missing or not a plain string",
        "receiver_id" => "receiver_id is missing or not a plain string",
        "account_id" => "account_id is missing or not a plain string",
        "dish" => "dish is missing or not a plain string",
        "holder" => "holder is missing or not a plain string",
        "minter" => "minter is missing or not a plain string",
        "method" => "method is missing or not a plain string",
        "previous_owner_id" => "previous_owner_id is missing",
        "sender_id" => "sender_id is missing",
        _ => "an argument is missing or not a plain string",
    }
}

/// A JSON writer into a byte buffer.
pub struct Out(pub Vec<u8>);

impl Out {
    pub fn new() -> Self {
        Out(Vec::with_capacity(256))
    }
    pub fn s(&mut self, raw: &str) -> &mut Self {
        self.0.extend_from_slice(raw.as_bytes());
        self
    }
    pub fn raw(&mut self, raw: &[u8]) -> &mut Self {
        self.0.extend_from_slice(raw);
        self
    }
    /// A quoted string, escaped.
    pub fn q(&mut self, v: &[u8]) -> &mut Self {
        self.0.push(b'"');
        for &c in v {
            match c {
                b'"' => self.0.extend_from_slice(b"\\\""),
                b'\\' => self.0.extend_from_slice(b"\\\\"),
                0..=0x1f => {}
                _ => self.0.push(c),
            }
        }
        self.0.push(b'"');
        self
    }
    /// A decimal number, unquoted.
    pub fn n(&mut self, mut v: u128) -> &mut Self {
        let mut buf = [0u8; 40];
        let mut i = buf.len();
        loop {
            i -= 1;
            buf[i] = b'0' + (v % 10) as u8;
            v /= 10;
            if v == 0 {
                break;
            }
        }
        self.0.extend_from_slice(&buf[i..]);
        self
    }
    /// A decimal number as a JSON string (for u128 amounts, as NEAR's standards write them).
    pub fn qn(&mut self, v: u128) -> &mut Self {
        self.0.push(b'"');
        self.n(v);
        self.0.push(b'"');
        self
    }
    pub fn done(self) -> Vec<u8> {
        self.0
    }
}

impl Default for Out {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_keys() {
        let o = br#" { "a" : 1, "b":"x\"y", "c": {"d":[1,{"e":"}"}]}, "token_id":"12", "n": null } "#;
        assert_eq!(get(o, "a"), Some(&b"1"[..]));
        assert_eq!(get(o, "b"), Some(&br#""x\"y""#[..]));
        assert_eq!(plain_str(get(o, "b").unwrap()), None);
        assert_eq!(get(o, "c"), Some(&br#"{"d":[1,{"e":"}"}]}"#[..]));
        assert_eq!(plain_str(get(o, "token_id").unwrap()), Some(&b"12"[..]));
        assert_eq!(get(o, "n"), None);
        assert_eq!(get(o, "zz"), None);
        assert_eq!(get(b"[1]", "a"), None);
        assert_eq!(get(b"{\"a\":", "a"), None);
        let mut keys = Vec::new();
        each(br#"{"payout":{"m.near":"500","f.near":"9500"}}"#, |k, v| {
            each(v, |k2, _| {
                keys.push(k2.to_vec());
                false
            });
            k == b"payout"
        });
        assert_eq!(keys, vec![b"m.near".to_vec(), b"f.near".to_vec()]);
    }

    #[test]
    fn numbers() {
        assert_eq!(uint(b"\"340282366920938463463374607431768211455\""), Some(u128::MAX));
        assert_eq!(uint(b"\"340282366920938463463374607431768211456\""), None);
        assert_eq!(uint(b"42"), Some(42));
        assert_eq!(uint(b"-1"), None);
        let mut o = Out::new();
        o.n(0).s(",").qn(1234567890123456789012345678).s(",").q(b"a\"b");
        assert_eq!(o.done(), br#"0,"1234567890123456789012345678","a\"b""#.to_vec());
    }
}
