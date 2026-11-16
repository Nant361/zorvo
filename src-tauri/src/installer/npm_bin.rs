//! Which program of an npm package is the agent, by `npx`'s own rule.

use super::install::is_single_name;

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

    #[test]
    fn the_unscoped_name_drops_scope_and_version() {
        assert_eq!(unscoped_name("@qwen-code/qwen-code@0.27.0"), "qwen-code");
        assert_eq!(unscoped_name("tool@1.0.0"), "tool");
        assert_eq!(unscoped_name("tool"), "tool");
        assert_eq!(unscoped_name("@scope/tool"), "tool");
    }
}
