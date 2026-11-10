//! A small in-memory chain for native tests: one contract's storage, the call's context, and the promises it made.
//! `call` runs a contract method the way the runtime would: a failure rolls the storage back.

use std::cell::RefCell;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    CreateAccount,
    Deploy(usize),
    Call { method: String, args: String, amount: u128, gas: u64, weight: u64 },
    Transfer(u128),
}

#[derive(Clone, Debug)]
pub struct Promise {
    pub account: String,
    pub actions: Vec<Action>,
    /// The promise this one waits for.
    pub after: Option<u64>,
}

#[derive(Clone, Debug, Default)]
pub struct Chain {
    pub current: String,
    pub predecessor: String,
    pub input: Vec<u8>,
    pub attached: u128,
    pub balance: u128,
    pub prepaid_gas: u64,
    pub height: u64,
    pub ms: u64,
    /// Bytes the account takes besides its contract storage (the account record and the code).
    pub base_usage: u64,
    pub storage: BTreeMap<Vec<u8>, Vec<u8>>,
    pub promises: Vec<Promise>,
    pub returned: Option<Vec<u8>>,
    pub returned_promise: Option<u64>,
    pub logs: Vec<String>,
    /// What the promises a callback waits for returned (None: failed).
    pub results: Vec<Option<Vec<u8>>>,
}

thread_local! {
    pub static CHAIN: RefCell<Chain> = RefCell::new(Chain::default());
}

pub fn with<R>(f: impl FnOnce(&mut Chain) -> R) -> R {
    CHAIN.with(|c| f(&mut c.borrow_mut()))
}

/// Run `f` (a contract method) as `predecessor` with `args` and `attached` yoctoNEAR. Returns the value it returned,
/// or the message it failed with; a failure leaves storage as it was and refunds nothing else.
pub fn call(f: fn(), predecessor: &str, args: &str, attached: u128) -> Result<Option<String>, String> {
    let saved = with(|c| {
        c.predecessor = predecessor.into();
        c.input = args.as_bytes().to_vec();
        c.attached = attached;
        c.balance += attached;
        c.promises.clear();
        c.returned = None;
        c.returned_promise = None;
        c.logs.clear();
        (c.storage.clone(), c.balance - attached)
    });
    let r = std::panic::catch_unwind(f);
    match r {
        Ok(()) => Ok(with(|c| c.returned.clone().map(|v| String::from_utf8(v).unwrap()))),
        Err(e) => {
            with(|c| {
                c.storage = saved.0;
                c.balance = saved.1;
                c.promises.clear();
            });
            Err(e.downcast_ref::<String>().cloned().unwrap_or_else(|| "panic".into()))
        }
    }
}

pub fn input() -> Vec<u8> {
    with(|c| c.input.clone())
}
pub fn current() -> Vec<u8> {
    with(|c| c.current.as_bytes().to_vec())
}
pub fn predecessor() -> Vec<u8> {
    with(|c| c.predecessor.as_bytes().to_vec())
}
pub fn attached() -> u128 {
    with(|c| c.attached)
}
pub fn balance() -> u128 {
    with(|c| c.balance)
}
pub fn storage_usage() -> u64 {
    with(|c| c.base_usage + c.storage.iter().map(|(k, v)| (k.len() + v.len() + 40) as u64).sum::<u64>())
}
pub fn prepaid_gas() -> u64 {
    with(|c| c.prepaid_gas)
}
pub fn used_gas() -> u64 {
    5 * crate::TGAS
}
pub fn block_height() -> u64 {
    with(|c| c.height)
}
pub fn block_ms() -> u64 {
    with(|c| c.ms)
}
pub fn read(key: &[u8]) -> Option<Vec<u8>> {
    with(|c| c.storage.get(key).cloned())
}
pub fn write(key: &[u8], value: &[u8]) {
    with(|c| c.storage.insert(key.to_vec(), value.to_vec()));
}
pub fn remove(key: &[u8]) {
    with(|c| c.storage.remove(key));
}
pub fn ret(value: &[u8]) {
    with(|c| c.returned = Some(value.to_vec()));
}
pub fn log(msg: &[u8]) {
    with(|c| c.logs.push(String::from_utf8(msg.to_vec()).unwrap()));
}
pub fn fail(msg: &str) -> ! {
    std::panic::panic_any(msg.to_string())
}
pub fn batch(account: &[u8]) -> u64 {
    with(|c| {
        c.promises.push(Promise { account: String::from_utf8(account.to_vec()).unwrap(), actions: vec![], after: None });
        c.promises.len() as u64 - 1
    })
}
pub fn batch_then(after: u64, account: &[u8]) -> u64 {
    let p = batch(account);
    with(|c| c.promises[p as usize].after = Some(after));
    p
}
fn act(p: u64, a: Action) {
    with(|c| c.promises[p as usize].actions.push(a));
}
pub fn a_create(p: u64) {
    act(p, Action::CreateAccount)
}
pub fn a_deploy(p: u64, code: &[u8]) {
    act(p, Action::Deploy(code.len()))
}
pub fn a_call(p: u64, method: &str, args: &[u8], amount: u128, gas: u64, weight: u64) {
    with(|c| c.balance -= amount);
    act(p, Action::Call { method: method.into(), args: String::from_utf8(args.to_vec()).unwrap(), amount, gas, weight })
}
pub fn a_transfer(p: u64, amount: u128) {
    with(|c| c.balance -= amount);
    act(p, Action::Transfer(amount))
}
pub fn promise_return(p: u64) {
    with(|c| c.returned_promise = Some(p));
}
pub fn result_count() -> u64 {
    with(|c| c.results.len() as u64)
}
pub fn result(i: u64) -> Option<Vec<u8>> {
    with(|c| c.results.get(i as usize).cloned().flatten())
}
