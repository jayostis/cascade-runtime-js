use std::fs;

fn main() {
    napi_build::setup();
    println!("cargo:rerun-if-changed=Cargo.lock");
    let lock = fs::read_to_string("Cargo.lock").expect("Cargo.lock is read");
    let mut lines = lock.lines();
    let version = loop {
        match lines.next() {
            Some("name = \"oxigraph\"") => break lines.next(),
            Some(_) => continue,
            None => break None,
        }
    }
    .and_then(|line| line.strip_prefix("version = \""))
    .and_then(|line| line.strip_suffix('"'))
    .expect("Cargo.lock names the version of the oxigraph crate");
    println!("cargo:rustc-env=OXIGRAPH_VERSION={version}");
}
