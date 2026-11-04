//! Starting a dish again from generation zero on an account that ran v5 (petri-dish.near).
//!
//! v5's layout, every key it could write: its state (`STATE`, overwritten here), the board (`board`), seven packed
//! per-colony arrays (`u`, `t`, `p`, `w`, `v`, `x`, `a`), lab notes (`n` + ledger index), the vectors of colonies
//! (`c`), the ledger (`l`), the planting and tide indexes (`i`, `k`) and slides (`S`), each entry at prefix + u32
//! index, and maps keyed by prefix + borsh: colony ids (`o`), names (`m`), PETRI balances (`b`), sponsored credit
//! (`s`), slides by owner (`Q`) and pending NEAR (`P`). Vectors are found by probing their indexes; colony accounts,
//! names and slide owners are read from their records; accounts that hold a balance, credit or pending NEAR without
//! a colony are passed in `accounts`. v6 writes under different prefixes (and the same `board`), so a key a wrong
//! account list leaves behind is never read as v6 state: it only keeps its storage.
//!
//! The method is private: only a transaction signed with the contract account's own full-access key can run it, at
//! the deploy. Once that key is deleted nobody can, and a dish that has started cannot be started again.

use crate::*;

const V5_ARRAYS: [&[u8]; 8] = [b"board", b"u", b"t", b"p", b"w", b"v", b"x", b"a"];

fn key(prefix: &[u8], rest: &[u8]) -> Vec<u8> {
    let mut k = prefix.to_vec();
    k.extend_from_slice(rest);
    k
}

fn borsh_str(s: &str) -> Vec<u8> {
    let mut b = (s.len() as u32).to_le_bytes().to_vec();
    b.extend_from_slice(s.as_bytes());
    b
}

/// A borsh string at `at` in `b`, and where the next field starts.
fn read_str(b: &[u8], at: usize) -> (String, usize) {
    let n = u32::from_le_bytes(b[at..at + 4].try_into().unwrap()) as usize;
    (String::from_utf8(b[at + 4..at + 4 + n].to_vec()).unwrap(), at + 4 + n)
}

/// Every element of a v5 vector: removed, and handed to `each` first.
fn drain_vector(prefix: &[u8], mut each: impl FnMut(&[u8])) -> u32 {
    let mut i = 0u32;
    loop {
        let k = key(prefix, &i.to_le_bytes());
        match env::storage_read(&k) {
            Some(v) => {
                each(&v);
                env::storage_remove(&k);
                i += 1;
            }
            None => return i,
        }
    }
}

#[near]
impl Petri {
    /// Delete everything v5 stored and launch a fresh dish with `rules`, as `new` does. `accounts` are the accounts
    /// with a v5 PETRI registration, sponsored credit or pending NEAR that had no colony (the keeper, guests). Logs any
    /// pending NEAR v5 still owed, so it can be settled by hand.
    #[private]
    #[init(ignore_state)]
    pub fn relaunch(rules: Rules, accounts: Vec<AccountId>) -> Self {
        // Only a v5 dish: v6 keeps colonies' numbers in pages this method does not clear.
        require!(!env::storage_has_key(&[b'U', 0, 0]) && !env::storage_has_key(b"H"), "this account already ran v6; relaunch only clears v5");
        let mut owners: Vec<String> = accounts.iter().map(|a| a.to_string()).collect();
        let mut names: Vec<String> = Vec::new();
        let colonies = drain_vector(b"c", |v| {
            // A v5 colony begins with its id (u16), its account and its name.
            let (account, at) = read_str(v, 2);
            let (name, _) = read_str(v, at);
            owners.push(account);
            names.push(name.to_lowercase());
        });
        let mut notes: Vec<u64> = Vec::new();
        drain_vector(b"i", |v| notes.push(u64::from_le_bytes(v[..8].try_into().unwrap())));
        for n in notes {
            env::storage_remove(&key(b"n", &n.to_le_bytes()));
        }
        let entries = drain_vector(b"l", |_| {});
        drain_vector(b"k", |_| {});
        // A v5 slide begins with its owner.
        let slides = drain_vector(b"S", |v| owners.push(read_str(v, 0).0));
        owners.sort();
        owners.dedup();
        for a in &owners {
            let b = borsh_str(a);
            if let Some(p) = env::storage_read(&key(b"P", &b)) {
                let near = u128::from_le_bytes(p[..16].try_into().unwrap());
                if near > 0 {
                    log!("v5 owed {} pending NEAR to {}", fmt_near(near), a);
                }
            }
            for prefix in [b"o", b"b", b"s", b"P", b"Q"] {
                env::storage_remove(&key(prefix, &b));
            }
        }
        for n in &names {
            env::storage_remove(&key(b"m", &borsh_str(n)));
        }
        for k in V5_ARRAYS {
            env::storage_remove(k);
        }
        emit("relaunch", json!({ "colonies": colonies, "entries": entries, "slides": slides, "accounts": owners.len() }));
        Self::launch(rules)
    }
}
