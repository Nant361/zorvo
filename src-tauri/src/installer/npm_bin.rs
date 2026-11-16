//! Which program of an npm package is the agent, by `npx`'s own rule.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::install::is_single_name;

/// The program to run among what an npm install linked into `bin_dir`, as
/// `npx` picks it: names that all lead to one file are one program (the
/// first by name is taken), otherwise [`choose_bin`] decides by name.
pub fn choose_installed_bin(spec: &str, bin_dir: &Path) -> Option<String> {
    let names = file_names_in(bin_dir);
    let targets: BTreeSet<_> = names
        .iter()
        .map(|name| fs::canonicalize(bin_dir.join(name)).ok())
        .collect();
    let is_one_program = targets.len() == 1 && !targets.contains(&None);
    match names.first() {
        Some(first) if is_one_program && is_single_name(first) => Some(first.clone()),
        _ => choose_bin(spec, &names),
    }
}

/// The file an install record's `bin` names inside `install_dir`, when it is
/// there. `bin` comes from a file on disk, so it counts only as a relative
/// path of plain parts: it can never name a program outside the install.
pub fn recorded_program(install_dir: &Path, bin: &str) -> Option<PathBuf> {
    let relative = Path::new(bin);
    let is_inside = !bin.is_empty()
        && relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
    let program = install_dir.join(relative);
    (is_inside && program.is_file()).then_some(program)
}

/// The names of what is directly in `dir`, sorted; none when it cannot be read.
fn file_names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

/// The package's name without its scope and version:
/// `qwen-code` for `@qwen-code/qwen-code@0.27.0`.
pub fn unscoped_name(spec: &str) -> &str {
    let name = match spec.rfind('@') {
        Some(at) if at > 0 => &spec[..at],
        _ => spec,
    };
    name.rsplit('/').next().unwrap_or(name)
}

/// The program to run among the names in the install's `bin` folder: the only
/// one, else the one named like the package. A name that is not one plain
/// path part never counts, so the choice stays inside that folder.
pub fn choose_bin(spec: &str, bins: &[String]) -> Option<String> {
    let plain: Vec<&String> = bins.iter().filter(|name| is_single_name(name)).collect();
    if plain.len() != bins.len() {
        return None;
    }
    match plain.as_slice() {
        [only] => Some((*only).clone()),
        several => several
            .iter()
            .find(|name| name.as_str() == unscoped_name(spec))
            .map(|name| (*name).clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_only_bin_is_chosen() {
        assert_eq!(
            choose_bin("@qwen-code/qwen-code@0.27.0", &names(&["qwen"])),
            Some("qwen".into())
        );
    }

    #[test]
    fn among_several_the_one_named_like_the_package_is_chosen() {
        assert_eq!(
            choose_bin("@scope/tool@1.0.0", &names(&["helper", "tool"])),
            Some("tool".into())
        );
        assert_eq!(
            choose_bin("tool@1.0.0", &names(&["tool", "x"])),
            Some("tool".into())
        );
    }

    #[test]
    fn several_bins_with_none_named_like_the_package_choose_nothing() {
        assert_eq!(choose_bin("@scope/tool@1.0.0", &names(&["a", "b"])), None);
    }

    #[test]
    fn no_bin_chooses_nothing() {
        assert_eq!(choose_bin("tool@1.0.0", &[]), None);
    }

    #[test]
    fn a_name_with_a_path_part_is_never_chosen() {
        assert_eq!(choose_bin("tool@1.0.0", &names(&["../tool"])), None);
        assert_eq!(choose_bin("tool@1.0.0", &names(&["a/b"])), None);
    }

    fn temp_bin_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zorvo-npm-bin-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        dir
    }

    #[test]
    fn names_that_link_to_one_file_count_as_one_program() {
        let dir = temp_bin_dir("aliases");
        std::fs::write(dir.join("cli.js"), "").unwrap();
        for name in ["kilocode", "kilo"] {
            std::os::unix::fs::symlink("../cli.js", dir.join("bin").join(name)).unwrap();
        }

        let chosen = choose_installed_bin("@kilocode/cli@7.8.12", &dir.join("bin"));

        assert_eq!(chosen, Some("kilo".into()), "the first by name");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_that_link_to_different_files_follow_the_package_name() {
        let dir = temp_bin_dir("distinct");
        for (name, target) in [("helper", "a.js"), ("tool", "b.js")] {
            std::fs::write(dir.join(target), "").unwrap();
            std::os::unix::fs::symlink(format!("../{target}"), dir.join("bin").join(name)).unwrap();
        }

        assert_eq!(
            choose_installed_bin("@scope/tool@1.0.0", &dir.join("bin")),
            Some("tool".into())
        );
        assert_eq!(
            choose_installed_bin("@scope/cli@1.0.0", &dir.join("bin")),
            None
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_bin_folder_chooses_nothing() {
        let dir = temp_bin_dir("missing");
        assert_eq!(choose_installed_bin("tool@1.0.0", &dir.join("nope")), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_unscoped_name_drops_scope_and_version() {
        assert_eq!(unscoped_name("@qwen-code/qwen-code@0.27.0"), "qwen-code");
        assert_eq!(unscoped_name("tool@1.0.0"), "tool");
        assert_eq!(unscoped_name("tool"), "tool");
        assert_eq!(unscoped_name("@scope/tool"), "tool");
    }
}
