//! Computer use: agents see and operate apps on the user's Mac through
//! trycua's cua-driver, behind grants Zorvo owns.
//!
//! `driver` finds and checks the driver Zorvo ships; `worker` talks to it.
//! Agents never reach the driver: Zorvo's backend is its only client.

pub mod driver;
pub mod worker;

pub use driver::{DriverPin, DriverUnavailable};
pub use worker::{CallId, DriverClient, DriverError, SessionHandle, StartOptions};
