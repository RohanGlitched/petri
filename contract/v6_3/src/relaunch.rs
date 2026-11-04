//! Starting a dish again from generation zero on an account that ran v6.2 (petri-dish.near and petri-v6.testnet).
//!
//! v6.2's layout, every key it could write: its state (`STATE`, overwritten here), the board (`board`), the vectors of
//! colonies (`C`), the ledger (`L`), the planting index (`I`, u32 ledger positions) and slides (`D`), each element at
//! prefix + u32 index; lab notes (`N` + u32 ledger index); the tide index (`V` + u32 page); maps keyed by prefix +
//! borsh: colony ids (`F`), names (`A`), PETRI balances (`r`), sponsors' grants (`e`), slides by owner (`T`) and
//! pending NEAR (`z`); the cold pages (`x` + u16 page, 32 colonies a page); the hot table (`h`, `j`); pacts (`P` + u32
//! number, from 1) and each colony's pact list (`Q` + u16 colony id). Vectors and the tide index are found by probing
//! their indexes, pacts by probing their numbers, notes from the planting index, cold pages and pact lists from the
//! number of colonies; colony accounts, names and slide owners are read from their records; accounts that hold a
//! balance, credit or pending NEAR without a colony or a slide are passed in `accounts`. v6.3 keeps everything under the
//! same keys (all deleted here) except balances (`s`), grants (`g`), pending NEAR (`y`) and the cold pages (`w`), the
//! keys a wrong account list could leave behind: under prefixes no earlier version used, such a key is never read as
//! v6.3 state; it only keeps its storage.
//!
//! The method is private: only a transaction signed with the contract account's own full-access key can run it, at
//! the deploy. Once that key is deleted nobody can, and nothing can change the rules.

use crate::*;

const V62_PAGE: u32 = 32;

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

/// Every key `prefix` + u32 from `from` up to the first missing one: removed, and handed to `each` first.
fn drain(prefix: &[u8], from: u32, mut each: impl FnMut(&[u8])) -> u32 {
    let mut i = from;
    loop {
        let k = key(prefix, &i.to_le_bytes());
        match env::storage_read(&k) {
            Some(v) => {
                each(&v);
                env::storage_remove(&k);
                i += 1;
            }
            None => return i - from,
        }
    }
}

#[near]
impl Petri {
    /// Delete everything v6.2 stored and launch a fresh dish with `rules`, as `new` does. `accounts` are the accounts
    /// with a v6.2 PETRI registration, sponsored credit or pending NEAR that had neither a colony nor a slide (keepers,
    /// guests sponsored before they joined, accounts paid for with wNEAR). Logs any pending NEAR v6.2 still owed, so it
    /// can be settled by hand.
    #[private]
    #[init(ignore_state)]
    pub fn relaunch(rules: Rules, accounts: Vec<AccountId>) -> Self {
        // Only a v6.2 dish: its first cold page exists once anyone joined, and v6.3 writes its pages under another prefix.
        require!(env::storage_has_key(&[b'x', 0, 0]), "no v6.2 dish here: relaunch clears a v6.2 dish that has colonies");
        require!(!env::storage_has_key(&books::cold_key(0)), "this account already runs v6.3");
        let mut owners: Vec<String> = accounts.iter().map(|a| a.to_string()).collect();
        let mut names: Vec<String> = Vec::new();
        let colonies = drain(b"C", 0, |v| {
            // A colony begins with its id (u16), its account and its name.
            let (account, at) = read_str(v, 2);
            let (name, _) = read_str(v, at);
            owners.push(account);
            names.push(name.to_lowercase());
        });
        let mut notes: Vec<u32> = Vec::new();
        drain(b"I", 0, |v| notes.push(u32::from_le_bytes(v[..4].try_into().unwrap())));
        for n in notes {
            env::storage_remove(&key(b"N", &n.to_le_bytes()));
        }
        let entries = drain(b"L", 0, |_| {});
        drain(b"V", 0, |_| {});
        let pacts = drain(b"P", 1, |_| {});
        // A slide begins with its owner.
        let slides = drain(b"D", 0, |v| owners.push(read_str(v, 0).0));
        owners.sort();
        owners.dedup();
        for a in &owners {
            let b = borsh_str(a);
            if let Some(p) = env::storage_read(&key(b"z", &b)) {
                let near = u128::from_le_bytes(p[..16].try_into().unwrap());
                if near > 0 {
                    log!("v6.2 owed {} pending NEAR to {}", fmt_near(near), a);
                }
            }
            for prefix in [b"F", b"r", b"e", b"T", b"z"] {
                env::storage_remove(&key(prefix, &b));
            }
        }
        for n in &names {
            env::storage_remove(&key(b"A", &borsh_str(n)));
        }
        for page in 0..colonies.div_ceil(V62_PAGE) {
            env::storage_remove(&key(b"x", &(page as u16).to_le_bytes()));
        }
        for id in 1..=colonies {
            env::storage_remove(&key(b"Q", &(id as u16).to_le_bytes()));
        }
        for k in [&b"board"[..], b"h", b"j"] {
            env::storage_remove(k);
        }
        emit("relaunch", json!({ "colonies": colonies, "entries": entries, "slides": slides, "pacts": pacts, "accounts": owners.len() }));
        Self::launch(rules)
    }
}
