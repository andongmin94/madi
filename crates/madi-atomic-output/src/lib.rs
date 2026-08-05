use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const SHA256_HEX_LENGTH: usize = 64;
const VOLUME_SERIAL_HEX_LENGTH: usize = 16;
const FILE_ID_HEX_LENGTH: usize = 32;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "mode", deny_unknown_fields)]
pub enum AtomicOutputRequest {
    Inspect {
        path: PathBuf,
        #[serde(rename = "maximumBytes")]
        maximum_bytes: u64,
    },
    Commit {
        #[serde(rename = "stagedPath")]
        staged_path: PathBuf,
        #[serde(rename = "destinationPath")]
        destination_path: PathBuf,
        #[serde(rename = "backupPath")]
        backup_path: PathBuf,
        #[serde(rename = "rollbackPath")]
        rollback_path: PathBuf,
        #[serde(rename = "maximumBytes")]
        maximum_bytes: u64,
        expected: FileIdentity,
        #[serde(rename = "stagedIdentity")]
        staged_identity: FileIdentity,
    },
    Recover {
        #[serde(rename = "stagedPath")]
        staged_path: PathBuf,
        #[serde(rename = "destinationPath")]
        destination_path: PathBuf,
        #[serde(rename = "backupPath")]
        backup_path: PathBuf,
        #[serde(rename = "rollbackPath")]
        rollback_path: PathBuf,
        #[serde(rename = "maximumBytes")]
        maximum_bytes: u64,
        expected: FileIdentity,
        #[serde(rename = "stagedIdentity")]
        staged_identity: FileIdentity,
    },
    Publish {
        #[serde(rename = "sourcePath")]
        source_path: PathBuf,
        #[serde(rename = "recoveryPath")]
        recovery_path: PathBuf,
        #[serde(rename = "maximumBytes")]
        maximum_bytes: u64,
        expected: FileIdentity,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileIdentity {
    pub byte_length: u64,
    pub sha256: String,
    pub volume_serial_number: String,
    pub file_id: String,
}

impl FileIdentity {
    fn validate(&self, maximum_bytes: u64) -> Result<(), AtomicOutputError> {
        if self.byte_length == 0 || self.byte_length > maximum_bytes {
            return Err(AtomicOutputError::InvalidRequest);
        }
        validate_lower_hex(&self.sha256, SHA256_HEX_LENGTH)?;
        validate_lower_hex(&self.volume_serial_number, VOLUME_SERIAL_HEX_LENGTH)?;
        validate_lower_hex(&self.file_id, FILE_ID_HEX_LENGTH)?;
        Ok(())
    }
}

fn validate_lower_hex(value: &str, exact_length: usize) -> Result<(), AtomicOutputError> {
    if value.len() != exact_length
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AtomicOutputError::InvalidRequest);
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AtomicOutputError {
    InvalidRequest,
    DestinationChanged,
    RecoveryRequired,
    Unsupported,
    Io,
}

impl AtomicOutputError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest => "INVALID_REQUEST",
            Self::DestinationChanged => "DESTINATION_CHANGED",
            Self::RecoveryRequired => "RECOVERY_REQUIRED",
            Self::Unsupported => "UNSUPPORTED",
            Self::Io => "IO_FAILED",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "status")]
pub enum AtomicOutputResponse {
    Inspected {
        identity: FileIdentity,
    },
    Committed {
        #[serde(rename = "stagedIdentity")]
        staged_identity: FileIdentity,
        #[serde(rename = "backupIdentity")]
        backup_identity: FileIdentity,
    },
    Recovered {
        outcome: RecoveryOutcome,
        #[serde(rename = "recoveryArtifact", skip_serializing_if = "Option::is_none")]
        recovery_artifact: Option<RecoveryArtifact>,
    },
    Published {
        identity: FileIdentity,
    },
    Failed {
        code: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryOutcome {
    CommitComplete,
    RolledBack,
    DestinationChanged,
    NothingToDo,
    RecoveryRequired,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryArtifactSource {
    Staged,
    Backup,
    Rollback,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryArtifact {
    pub source: RecoveryArtifactSource,
    pub identity: FileIdentity,
}

pub fn execute(request: AtomicOutputRequest) -> AtomicOutputResponse {
    match execute_result(request) {
        Ok(response) => response,
        Err(error) => AtomicOutputResponse::Failed {
            code: error.code().to_owned(),
        },
    }
}

fn execute_result(request: AtomicOutputRequest) -> Result<AtomicOutputResponse, AtomicOutputError> {
    match request {
        AtomicOutputRequest::Inspect {
            path,
            maximum_bytes,
        } => {
            validate_maximum(maximum_bytes)?;
            let identity = platform::inspect(&path, maximum_bytes)?;
            Ok(AtomicOutputResponse::Inspected { identity })
        }
        AtomicOutputRequest::Commit {
            staged_path,
            destination_path,
            backup_path,
            rollback_path,
            maximum_bytes,
            expected,
            staged_identity,
        } => {
            validate_maximum(maximum_bytes)?;
            expected.validate(maximum_bytes)?;
            staged_identity.validate(maximum_bytes)?;
            validate_commit_paths(
                &staged_path,
                &destination_path,
                &backup_path,
                &rollback_path,
            )?;
            let (staged_identity, backup_identity) = platform::commit(
                &staged_path,
                &destination_path,
                &backup_path,
                &rollback_path,
                maximum_bytes,
                &expected,
                &staged_identity,
            )?;
            Ok(AtomicOutputResponse::Committed {
                staged_identity,
                backup_identity,
            })
        }
        AtomicOutputRequest::Recover {
            staged_path,
            destination_path,
            backup_path,
            rollback_path,
            maximum_bytes,
            expected,
            staged_identity,
        } => {
            validate_maximum(maximum_bytes)?;
            expected.validate(maximum_bytes)?;
            staged_identity.validate(maximum_bytes)?;
            validate_commit_paths(
                &staged_path,
                &destination_path,
                &backup_path,
                &rollback_path,
            )?;
            let (outcome, recovery_artifact) = platform::recover(
                &staged_path,
                &destination_path,
                &backup_path,
                &rollback_path,
                maximum_bytes,
                &expected,
                &staged_identity,
            )?;
            Ok(AtomicOutputResponse::Recovered {
                outcome,
                recovery_artifact,
            })
        }
        AtomicOutputRequest::Publish {
            source_path,
            recovery_path,
            maximum_bytes,
            expected,
        } => {
            validate_maximum(maximum_bytes)?;
            expected.validate(maximum_bytes)?;
            if !source_path.is_absolute()
                || !recovery_path.is_absolute()
                || source_path == recovery_path
                || source_path.file_name().is_none()
                || recovery_path.file_name().is_none()
            {
                return Err(AtomicOutputError::InvalidRequest);
            }
            let identity =
                platform::publish(&source_path, &recovery_path, maximum_bytes, &expected)?;
            Ok(AtomicOutputResponse::Published { identity })
        }
    }
}

fn validate_maximum(maximum_bytes: u64) -> Result<(), AtomicOutputError> {
    if maximum_bytes == 0 || maximum_bytes > 512 * 1024 * 1024 {
        return Err(AtomicOutputError::InvalidRequest);
    }
    Ok(())
}

fn validate_commit_paths(
    staged_path: &Path,
    destination_path: &Path,
    backup_path: &Path,
    rollback_path: &Path,
) -> Result<(), AtomicOutputError> {
    if !staged_path.is_absolute()
        || !destination_path.is_absolute()
        || !backup_path.is_absolute()
        || !rollback_path.is_absolute()
        || staged_path == destination_path
        || staged_path == backup_path
        || destination_path == backup_path
        || rollback_path == staged_path
        || rollback_path == destination_path
        || rollback_path == backup_path
        || staged_path.parent().is_none()
        || destination_path.parent().is_none()
        || backup_path.parent() != staged_path.parent()
        || rollback_path.parent() != staged_path.parent()
        || staged_path.file_name().is_none()
        || destination_path.file_name().is_none()
        || backup_path.file_name().is_none()
        || rollback_path.file_name().is_none()
    {
        return Err(AtomicOutputError::InvalidRequest);
    }
    Ok(())
}

#[cfg(windows)]
mod platform {
    use super::{
        AtomicOutputError, FileIdentity, RecoveryArtifact, RecoveryArtifactSource, RecoveryOutcome,
    };
    use sha2::{Digest, Sha256};
    use std::fs::File;
    use std::io::{Read, Seek, SeekFrom};
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{FromRawHandle, RawHandle};
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{
        GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CopyFileW, CreateFileW, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_FLAG_SEQUENTIAL_SCAN, FILE_ID_INFO,
        FILE_READ_ATTRIBUTES, FILE_RENAME_INFO, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, FILE_TRAVERSE, FileAttributeTagInfo, FileIdInfo, FileRenameInfoEx,
        FlushFileBuffers, GetFileInformationByHandleEx, OPEN_EXISTING, ReplaceFileW,
        SetFileInformationByHandle,
    };
    use windows_sys::Win32::Storage::FileSystem::{DELETE, SYNCHRONIZE};
    const ERROR_SHARING_VIOLATION: i32 = 32;
    const ERROR_LOCK_VIOLATION: i32 = 33;
    const ERROR_NOT_SUPPORTED: i32 = 50;
    const ERROR_INVALID_PARAMETER: i32 = 87;
    const ERROR_UNABLE_TO_REMOVE_REPLACED: i32 = 1175;
    const ERROR_UNABLE_TO_MOVE_REPLACEMENT: i32 = 1176;
    const ERROR_UNABLE_TO_MOVE_REPLACEMENT_2: i32 = 1177;

    pub(super) fn inspect(
        path: &Path,
        maximum_bytes: u64,
    ) -> Result<FileIdentity, AtomicOutputError> {
        let mut file = open_regular_file_locked(path, false, false)?;
        identity_from_file(&mut file, maximum_bytes)
    }

    pub(super) fn publish(
        source_path: &Path,
        recovery_path: &Path,
        maximum_bytes: u64,
        expected: &FileIdentity,
    ) -> Result<FileIdentity, AtomicOutputError> {
        let mut source = open_regular_file_locked(source_path, false, false)?;
        let source_identity = identity_from_file(&mut source, maximum_bytes)?;
        if source_identity != *expected {
            return Err(AtomicOutputError::RecoveryRequired);
        }
        let source_wide = wide_path(source_path)?;
        let recovery_wide = wide_path(recovery_path)?;
        if unsafe { CopyFileW(source_wide.as_ptr(), recovery_wide.as_ptr(), 1) } == 0 {
            return Err(AtomicOutputError::RecoveryRequired);
        }
        let mut recovery = open_regular_file_locked(recovery_path, true, true)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        let recovery_identity = identity_from_file(&mut recovery, maximum_bytes)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        if recovery_identity.byte_length != source_identity.byte_length
            || recovery_identity.sha256 != source_identity.sha256
            || recovery_identity.volume_serial_number != source_identity.volume_serial_number
        {
            return Err(AtomicOutputError::RecoveryRequired);
        }
        if unsafe { FlushFileBuffers(recovery.raw_handle() as HANDLE) } == 0 {
            return Err(AtomicOutputError::RecoveryRequired);
        }
        Ok(recovery_identity)
    }

    pub(super) fn commit(
        staged_path: &Path,
        destination_path: &Path,
        backup_path: &Path,
        rollback_path: &Path,
        maximum_bytes: u64,
        expected: &FileIdentity,
        staged_identity: &FileIdentity,
    ) -> Result<(FileIdentity, FileIdentity), AtomicOutputError> {
        commit_with_hooks(
            staged_path,
            destination_path,
            backup_path,
            rollback_path,
            maximum_bytes,
            expected,
            staged_identity,
            || {},
            || {},
        )
    }

    pub(super) fn recover(
        staged_path: &Path,
        destination_path: &Path,
        backup_path: &Path,
        rollback_path: &Path,
        maximum_bytes: u64,
        expected: &FileIdentity,
        staged_identity: &FileIdentity,
    ) -> Result<(RecoveryOutcome, Option<RecoveryArtifact>), AtomicOutputError> {
        let destination = inspect_optional(destination_path, maximum_bytes)?;
        let backup = inspect_optional(backup_path, maximum_bytes)?;
        let staged = inspect_optional(staged_path, maximum_bytes)?;
        let rollback = inspect_optional(rollback_path, maximum_bytes)?;
        match (destination, backup, staged, rollback) {
            (Some(destination), None, Some(staged), None)
                if destination == *expected && staged == *staged_identity =>
            {
                Ok((RecoveryOutcome::NothingToDo, None))
            }
            (Some(destination), Some(backup), None, None)
                if destination == *staged_identity && backup == *expected =>
            {
                Ok((RecoveryOutcome::CommitComplete, None))
            }
            (Some(destination), Some(backup), None, None)
                if destination == *staged_identity && backup != *expected =>
            {
                rollback_foreign_destination(
                    destination_path,
                    backup_path,
                    rollback_path,
                    maximum_bytes,
                    &backup,
                    staged_identity,
                )?;
                Ok((RecoveryOutcome::RolledBack, None))
            }
            (Some(destination), None, Some(staged), None)
                if staged == *staged_identity && destination != *expected =>
            {
                Ok((RecoveryOutcome::DestinationChanged, None))
            }
            (Some(destination), None, None, Some(rollback))
                if rollback == *staged_identity && destination != *staged_identity =>
            {
                Ok((RecoveryOutcome::DestinationChanged, None))
            }
            (None, Some(backup), Some(staged), None) if staged == *staged_identity => {
                restore_backup_without_replacement(
                    backup_path,
                    destination_path,
                    maximum_bytes,
                    &backup,
                )?;
                Ok((
                    if backup == *expected {
                        RecoveryOutcome::NothingToDo
                    } else {
                        RecoveryOutcome::DestinationChanged
                    },
                    None,
                ))
            }
            (None, Some(backup), None, Some(rollback)) if rollback == *staged_identity => {
                restore_backup_without_replacement(
                    backup_path,
                    destination_path,
                    maximum_bytes,
                    &backup,
                )?;
                Ok((RecoveryOutcome::DestinationChanged, None))
            }
            (Some(destination), Some(backup), _, _) if destination != *staged_identity => {
                Ok(recovery_required(RecoveryArtifactSource::Backup, backup))
            }
            (_, Some(backup), _, _) => {
                Ok(recovery_required(RecoveryArtifactSource::Backup, backup))
            }
            (_, None, _, Some(rollback)) => Ok(recovery_required(
                RecoveryArtifactSource::Rollback,
                rollback,
            )),
            (_, None, Some(staged), None) => {
                Ok(recovery_required(RecoveryArtifactSource::Staged, staged))
            }
            _ => Err(AtomicOutputError::RecoveryRequired),
        }
    }

    fn commit_with_hooks(
        staged_path: &Path,
        destination_path: &Path,
        backup_path: &Path,
        rollback_path: &Path,
        maximum_bytes: u64,
        expected: &FileIdentity,
        expected_staged: &FileIdentity,
        before_replace: impl FnOnce(),
        after_replace: impl FnOnce(),
    ) -> Result<(FileIdentity, FileIdentity), AtomicOutputError> {
        let mut staged = open_regular_file_locked(staged_path, true, true)?;
        let staged_identity = identity_from_file(&mut staged, maximum_bytes)?;
        if staged_identity != *expected_staged {
            return Err(AtomicOutputError::DestinationChanged);
        }
        if staged_identity.volume_serial_number != expected.volume_serial_number {
            return Err(AtomicOutputError::Unsupported);
        }
        let current = inspect(destination_path, maximum_bytes)?;
        if current != *expected {
            return Err(AtomicOutputError::DestinationChanged);
        }
        ensure_unused_recovery_path(backup_path)?;
        ensure_unused_recovery_path(rollback_path)?;
        if unsafe { FlushFileBuffers(staged.raw_handle() as HANDLE) } == 0 {
            return Err(last_error());
        }
        drop(staged);
        before_replace();
        if let Err(error_code) = replace_file(destination_path, staged_path, backup_path) {
            return reconcile_failed_replace(
                error_code,
                staged_path,
                destination_path,
                backup_path,
                rollback_path,
                maximum_bytes,
                expected,
                &staged_identity,
            );
        }
        after_replace();

        let mut backup = open_regular_file_locked(backup_path, false, false)?;
        let backup_identity = identity_from_file(&mut backup, maximum_bytes)?;
        drop(backup);
        let mut published = open_regular_file_locked(destination_path, false, false)?;
        let published_identity = identity_from_file(&mut published, maximum_bytes)?;
        drop(published);
        if published_identity != staged_identity {
            return Err(AtomicOutputError::RecoveryRequired);
        }
        if backup_identity != *expected {
            replace_file(destination_path, backup_path, rollback_path)
                .map_err(|_| AtomicOutputError::RecoveryRequired)?;
            let mut restored = open_regular_file_locked(destination_path, false, false)
                .map_err(|_| AtomicOutputError::RecoveryRequired)?;
            let restored_identity = identity_from_file(&mut restored, maximum_bytes)
                .map_err(|_| AtomicOutputError::RecoveryRequired)?;
            if restored_identity != backup_identity {
                return Err(AtomicOutputError::RecoveryRequired);
            }
            let rollback_identity = inspect(rollback_path, maximum_bytes)
                .map_err(|_| AtomicOutputError::RecoveryRequired)?;
            if rollback_identity != staged_identity {
                return Err(AtomicOutputError::RecoveryRequired);
            }
            return Err(AtomicOutputError::DestinationChanged);
        }
        Ok((staged_identity, backup_identity))
    }

    fn reconcile_failed_replace(
        error_code: i32,
        staged_path: &Path,
        destination_path: &Path,
        backup_path: &Path,
        rollback_path: &Path,
        maximum_bytes: u64,
        expected: &FileIdentity,
        staged_identity: &FileIdentity,
    ) -> Result<(FileIdentity, FileIdentity), AtomicOutputError> {
        let destination = inspect_optional(destination_path, maximum_bytes)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        let backup = inspect_optional(backup_path, maximum_bytes)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        let staged = inspect_optional(staged_path, maximum_bytes)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        let rollback = inspect_optional(rollback_path, maximum_bytes)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;

        match (destination, backup, staged, rollback) {
            (Some(destination), None, Some(staged), None) if staged == *staged_identity => {
                if destination != *expected {
                    Err(AtomicOutputError::DestinationChanged)
                } else {
                    Err(classify_replace_error(error_code))
                }
            }
            (None, Some(backup), Some(staged), None)
                if staged == *staged_identity
                    && error_code == ERROR_UNABLE_TO_MOVE_REPLACEMENT_2 =>
            {
                restore_backup_without_replacement(
                    backup_path,
                    destination_path,
                    maximum_bytes,
                    &backup,
                )?;
                if backup == *expected {
                    Err(AtomicOutputError::Io)
                } else {
                    Err(AtomicOutputError::DestinationChanged)
                }
            }
            _ => Err(AtomicOutputError::RecoveryRequired),
        }
    }

    fn rollback_foreign_destination(
        destination_path: &Path,
        backup_path: &Path,
        rollback_path: &Path,
        maximum_bytes: u64,
        backup_identity: &FileIdentity,
        staged_identity: &FileIdentity,
    ) -> Result<(), AtomicOutputError> {
        replace_file(destination_path, backup_path, rollback_path)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        let restored_identity = inspect(destination_path, maximum_bytes)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        let rollback_identity = inspect(rollback_path, maximum_bytes)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        if restored_identity != *backup_identity || rollback_identity != *staged_identity {
            return Err(AtomicOutputError::RecoveryRequired);
        }
        Ok(())
    }

    fn restore_backup_without_replacement(
        backup_path: &Path,
        destination_path: &Path,
        maximum_bytes: u64,
        backup_identity: &FileIdentity,
    ) -> Result<(), AtomicOutputError> {
        let mut backup = open_regular_file_locked(backup_path, true, false)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        let locked_identity = identity_from_file(&mut backup, maximum_bytes)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        if locked_identity != *backup_identity {
            return Err(AtomicOutputError::RecoveryRequired);
        }
        let destination_parent = destination_path
            .parent()
            .ok_or(AtomicOutputError::RecoveryRequired)?;
        let directory = open_directory_locked(destination_parent)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        rename_handle_without_replacement(&backup, &directory, destination_path.as_os_str())
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        drop(directory);
        drop(backup);
        let restored_identity = inspect(destination_path, maximum_bytes)
            .map_err(|_| AtomicOutputError::RecoveryRequired)?;
        if restored_identity != *backup_identity {
            return Err(AtomicOutputError::RecoveryRequired);
        }
        Ok(())
    }

    fn recovery_required(
        source: RecoveryArtifactSource,
        identity: FileIdentity,
    ) -> (RecoveryOutcome, Option<RecoveryArtifact>) {
        (
            RecoveryOutcome::RecoveryRequired,
            Some(RecoveryArtifact { source, identity }),
        )
    }

    fn ensure_unused_recovery_path(path: &Path) -> Result<(), AtomicOutputError> {
        if path.try_exists().map_err(|_| AtomicOutputError::Io)? {
            return Err(AtomicOutputError::InvalidRequest);
        }
        Ok(())
    }

    trait RawFileHandle {
        fn raw_handle(&self) -> RawHandle;
    }

    impl RawFileHandle for File {
        fn raw_handle(&self) -> RawHandle {
            use std::os::windows::io::AsRawHandle;
            self.as_raw_handle()
        }
    }

    fn open_regular_file_locked(
        path: &Path,
        delete_access: bool,
        write_access: bool,
    ) -> Result<File, AtomicOutputError> {
        let wide = wide_path(path)?;
        let desired_access = GENERIC_READ
            | FILE_READ_ATTRIBUTES
            | SYNCHRONIZE
            | if delete_access { DELETE } else { 0 }
            | if write_access { GENERIC_WRITE } else { 0 };
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                desired_access,
                FILE_SHARE_READ,
                null(),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(last_error());
        }
        let file = unsafe { File::from_raw_handle(handle as RawHandle) };
        reject_reparse_or_directory(file.raw_handle() as HANDLE)?;
        Ok(file)
    }

    // ReplaceFileW is one documented OS replacement operation, but Microsoft documents it as a
    // sequence of internal steps. Callers must tolerate transient name absence and reconcile the
    // documented 1175/1176/1177 failure layouts; this is not a no-gap rename primitive.
    fn replace_file(
        destination_path: &Path,
        replacement_path: &Path,
        backup_path: &Path,
    ) -> Result<(), i32> {
        let destination = wide_path(destination_path).map_err(|_| ERROR_INVALID_PARAMETER)?;
        let replacement = wide_path(replacement_path).map_err(|_| ERROR_INVALID_PARAMETER)?;
        let backup = wide_path(backup_path).map_err(|_| ERROR_INVALID_PARAMETER)?;
        if unsafe {
            ReplaceFileW(
                destination.as_ptr(),
                replacement.as_ptr(),
                backup.as_ptr(),
                0,
                null(),
                null(),
            )
        } == 0
        {
            return Err(raw_last_error());
        }
        Ok(())
    }

    fn open_directory_locked(path: &Path) -> Result<File, AtomicOutputError> {
        let wide = wide_path(path)?;
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(last_error());
        }
        let directory = unsafe { File::from_raw_handle(handle as RawHandle) };
        reject_reparse_or_non_directory(directory.raw_handle() as HANDLE)?;
        Ok(directory)
    }

    fn rename_handle_without_replacement(
        source: &File,
        _destination_directory: &File,
        destination_path: &std::ffi::OsStr,
    ) -> Result<(), AtomicOutputError> {
        let name: Vec<u16> = destination_path.encode_wide().collect();
        if name.is_empty() || name.contains(&0) {
            return Err(AtomicOutputError::InvalidRequest);
        }
        let name_bytes = name
            .len()
            .checked_mul(size_of::<u16>())
            .ok_or(AtomicOutputError::InvalidRequest)?;
        let buffer_size = size_of::<FILE_RENAME_INFO>()
            .checked_add(name_bytes.saturating_sub(size_of::<u16>()))
            .ok_or(AtomicOutputError::InvalidRequest)?;
        let mut buffer = vec![0u8; buffer_size];
        let info = buffer.as_mut_ptr() as *mut FILE_RENAME_INFO;
        unsafe {
            // FileRenameInfoEx interprets the union as Flags. Zero deliberately omits
            // FILE_RENAME_FLAG_REPLACE_IF_EXISTS, so a concurrent destination claim wins and both
            // files remain available for recovery.
            (*info).Anonymous.Flags = 0;
            // SetFileInformationByHandle's documented Win32 FILE_RENAME_INFO contract accepts an
            // absolute path with a null RootDirectory. On the supported Windows integration host,
            // FileRenameInfoEx rejected the kernel-style root-handle/relative-name form with
            // ERROR_INVALID_PARAMETER, while this Win32 form passed both success and no-clobber
            // tests. Keep the separately validated parent handle open across the call so a normal
            // directory rename/delete cannot race this recovery step.
            (*info).RootDirectory = null_mut();
            (*info).FileNameLength = name_bytes as u32;
            std::ptr::copy_nonoverlapping(name.as_ptr(), (*info).FileName.as_mut_ptr(), name.len());
            if SetFileInformationByHandle(
                source.raw_handle() as HANDLE,
                FileRenameInfoEx,
                buffer.as_ptr().cast(),
                buffer_size as u32,
            ) == 0
            {
                return Err(last_error());
            }
        }
        Ok(())
    }

    fn inspect_optional(
        path: &Path,
        maximum_bytes: u64,
    ) -> Result<Option<FileIdentity>, AtomicOutputError> {
        if !path.try_exists().map_err(|_| AtomicOutputError::Io)? {
            return Ok(None);
        }
        match inspect(path, maximum_bytes) {
            Ok(identity) => Ok(Some(identity)),
            Err(error) => Err(error),
        }
    }

    fn reject_reparse_or_directory(handle: HANDLE) -> Result<(), AtomicOutputError> {
        let mut tag: FILE_ATTRIBUTE_TAG_INFO = unsafe { zeroed() };
        if unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileAttributeTagInfo,
                &mut tag as *mut _ as *mut core::ffi::c_void,
                size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
        } == 0
        {
            return Err(last_error());
        }
        if tag.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY) != 0 {
            return Err(AtomicOutputError::Unsupported);
        }
        Ok(())
    }

    fn reject_reparse_or_non_directory(handle: HANDLE) -> Result<(), AtomicOutputError> {
        let mut tag: FILE_ATTRIBUTE_TAG_INFO = unsafe { zeroed() };
        if unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileAttributeTagInfo,
                &mut tag as *mut _ as *mut core::ffi::c_void,
                size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
        } == 0
        {
            return Err(last_error());
        }
        if tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        {
            return Err(AtomicOutputError::Unsupported);
        }
        Ok(())
    }

    fn identity_from_file(
        file: &mut File,
        maximum_bytes: u64,
    ) -> Result<FileIdentity, AtomicOutputError> {
        let metadata = file.metadata().map_err(|_| AtomicOutputError::Io)?;
        let byte_length = metadata.len();
        if byte_length == 0 || byte_length > maximum_bytes {
            return Err(AtomicOutputError::InvalidRequest);
        }
        let mut native: FILE_ID_INFO = unsafe { zeroed() };
        if unsafe {
            GetFileInformationByHandleEx(
                file.raw_handle() as HANDLE,
                FileIdInfo,
                &mut native as *mut _ as *mut core::ffi::c_void,
                size_of::<FILE_ID_INFO>() as u32,
            )
        } == 0
        {
            return Err(last_error());
        }
        file.seek(SeekFrom::Start(0))
            .map_err(|_| AtomicOutputError::Io)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let read = file.read(&mut buffer).map_err(|_| AtomicOutputError::Io)?;
            if read == 0 {
                break;
            }
            total = total
                .checked_add(read as u64)
                .ok_or(AtomicOutputError::InvalidRequest)?;
            if total > maximum_bytes {
                return Err(AtomicOutputError::InvalidRequest);
            }
            hasher.update(&buffer[..read]);
        }
        if total != byte_length {
            return Err(AtomicOutputError::DestinationChanged);
        }
        Ok(FileIdentity {
            byte_length,
            sha256: format!("{:x}", hasher.finalize()),
            volume_serial_number: format!("{:016x}", native.VolumeSerialNumber),
            file_id: native
                .FileId
                .Identifier
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        })
    }

    fn wide_path(path: &Path) -> Result<Vec<u16>, AtomicOutputError> {
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        if wide.is_empty() || wide.contains(&0) {
            return Err(AtomicOutputError::InvalidRequest);
        }
        wide.push(0);
        Ok(wide)
    }

    fn last_error() -> AtomicOutputError {
        classify_replace_error(raw_last_error())
    }

    fn raw_last_error() -> i32 {
        std::io::Error::last_os_error()
            .raw_os_error()
            .unwrap_or_default()
    }

    fn classify_replace_error(code: i32) -> AtomicOutputError {
        match code {
            ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION => AtomicOutputError::DestinationChanged,
            ERROR_NOT_SUPPORTED | ERROR_INVALID_PARAMETER => AtomicOutputError::Unsupported,
            ERROR_UNABLE_TO_REMOVE_REPLACED
            | ERROR_UNABLE_TO_MOVE_REPLACEMENT
            | ERROR_UNABLE_TO_MOVE_REPLACEMENT_2 => AtomicOutputError::Io,
            _ => AtomicOutputError::Io,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        const MAXIMUM: u64 = 1024 * 1024;

        #[test]
        fn substitution_immediately_before_replace_is_rolled_back_without_data_loss() {
            let directory = tempfile::tempdir().unwrap();
            let staging = directory.path().join("staging");
            std::fs::create_dir(&staging).unwrap();
            let destination = directory.path().join("publication.hwpx");
            let staged = directory.path().join("staged-publication.hwpx");
            let backup = directory.path().join("confirmed-destination.bin");
            let rollback = directory.path().join("rollback-staged.bin");
            std::fs::write(&destination, b"confirmed A").unwrap();
            let expected = inspect(&destination, MAXIMUM).unwrap();
            std::fs::write(&staged, b"staged S").unwrap();
            let staged_identity = inspect(&staged, MAXIMUM).unwrap();

            assert_eq!(
                commit_with_hooks(
                    &staged,
                    &destination,
                    &backup,
                    &rollback,
                    MAXIMUM,
                    &expected,
                    &staged_identity,
                    || {
                        std::fs::remove_file(&destination).unwrap();
                        std::fs::write(&destination, b"foreign B").unwrap();
                    },
                    || {},
                ),
                Err(AtomicOutputError::DestinationChanged)
            );
            assert_eq!(std::fs::read(&destination).unwrap(), b"foreign B");
            assert_eq!(std::fs::read(&rollback).unwrap(), b"staged S");
            assert!(!staged.exists());
            assert!(!backup.exists());
        }

        #[test]
        fn single_replace_file_call_publishes_complete_bytes_and_preserves_backup() {
            let directory = tempfile::tempdir().unwrap();
            let staging = directory.path().join("staging");
            std::fs::create_dir(&staging).unwrap();
            let destination = directory.path().join("publication.hwpx");
            let staged = directory.path().join("staged-publication.hwpx");
            let backup = directory.path().join("confirmed-destination.bin");
            let rollback = directory.path().join("rollback-staged.bin");
            std::fs::write(&destination, b"confirmed A").unwrap();
            std::fs::write(&staged, b"staged S").unwrap();
            let expected = inspect(&destination, MAXIMUM).unwrap();
            let expected_staged = inspect(&staged, MAXIMUM).unwrap();

            let result = commit_with_hooks(
                &staged,
                &destination,
                &backup,
                &rollback,
                MAXIMUM,
                &expected,
                &expected_staged,
                || {},
                || {},
            );

            let (staged_identity, backup_identity) = result.unwrap();
            assert_eq!(std::fs::read(&destination).unwrap(), b"staged S");
            assert_eq!(std::fs::read(&backup).unwrap(), b"confirmed A");
            assert!(!staged.exists());
            assert_eq!(backup_identity, expected);
            assert_eq!(staged_identity, inspect(&destination, MAXIMUM).unwrap());
        }

        #[test]
        fn concurrent_post_replace_claim_remains_visible_and_requires_recovery() {
            let directory = tempfile::tempdir().unwrap();
            let staging = directory.path().join("staging");
            std::fs::create_dir(&staging).unwrap();
            let destination = directory.path().join("publication.hwpx");
            let displaced = directory.path().join("foreign-preserved-S.hwpx");
            let staged = directory.path().join("staged-publication.hwpx");
            let backup = directory.path().join("confirmed-destination.bin");
            let rollback = directory.path().join("rollback-staged.bin");
            std::fs::write(&destination, b"confirmed A").unwrap();
            std::fs::write(&staged, b"staged S").unwrap();
            let expected = inspect(&destination, MAXIMUM).unwrap();
            let staged_identity = inspect(&staged, MAXIMUM).unwrap();

            assert_eq!(
                commit_with_hooks(
                    &staged,
                    &destination,
                    &backup,
                    &rollback,
                    MAXIMUM,
                    &expected,
                    &staged_identity,
                    || {},
                    || {
                        std::fs::rename(&destination, &displaced).unwrap();
                        std::fs::write(&destination, b"foreign C").unwrap();
                    },
                ),
                Err(AtomicOutputError::RecoveryRequired)
            );
            assert_eq!(std::fs::read(&destination).unwrap(), b"foreign C");
            assert_eq!(std::fs::read(&displaced).unwrap(), b"staged S");
            assert_eq!(std::fs::read(&backup).unwrap(), b"confirmed A");
            assert!(!staged.exists());
        }

        #[test]
        fn recovery_infers_pre_replace_commit_and_rollback_states() {
            let directory = tempfile::tempdir().unwrap();
            let destination = directory.path().join("publication.hwpx");
            let staged = directory.path().join("staged-publication.hwpx");
            let backup = directory.path().join("confirmed-destination.bin");
            let rollback = directory.path().join("rollback-staged.bin");
            std::fs::write(&destination, b"confirmed A").unwrap();
            std::fs::write(&staged, b"staged S").unwrap();
            let expected = inspect(&destination, MAXIMUM).unwrap();
            let staged_identity = inspect(&staged, MAXIMUM).unwrap();

            assert_eq!(
                recover(
                    &staged,
                    &destination,
                    &backup,
                    &rollback,
                    MAXIMUM,
                    &expected,
                    &staged_identity,
                )
                .unwrap(),
                (RecoveryOutcome::NothingToDo, None)
            );

            replace_file(&destination, &staged, &backup).unwrap();
            assert_eq!(
                recover(
                    &staged,
                    &destination,
                    &backup,
                    &rollback,
                    MAXIMUM,
                    &expected,
                    &staged_identity,
                )
                .unwrap(),
                (RecoveryOutcome::CommitComplete, None)
            );

            replace_file(&destination, &backup, &staged).unwrap();
            assert_eq!(
                recover(
                    &staged,
                    &destination,
                    &backup,
                    &rollback,
                    MAXIMUM,
                    &expected,
                    &staged_identity,
                )
                .unwrap(),
                (RecoveryOutcome::NothingToDo, None)
            );
        }

        #[test]
        fn recovery_rolls_back_a_foreign_pre_replace_owner_and_preserves_staged() {
            let directory = tempfile::tempdir().unwrap();
            let destination = directory.path().join("publication.hwpx");
            let staged = directory.path().join("staged-publication.hwpx");
            let backup = directory.path().join("confirmed-destination.bin");
            let rollback = directory.path().join("rollback-staged.bin");
            std::fs::write(&destination, b"confirmed A").unwrap();
            std::fs::write(&staged, b"staged S").unwrap();
            let expected = inspect(&destination, MAXIMUM).unwrap();
            let staged_identity = inspect(&staged, MAXIMUM).unwrap();
            std::fs::write(&destination, b"foreign B").unwrap();
            replace_file(&destination, &staged, &backup).unwrap();

            assert_eq!(
                recover(
                    &staged,
                    &destination,
                    &backup,
                    &rollback,
                    MAXIMUM,
                    &expected,
                    &staged_identity,
                )
                .unwrap(),
                (RecoveryOutcome::RolledBack, None)
            );
            assert_eq!(std::fs::read(&destination).unwrap(), b"foreign B");
            assert_eq!(std::fs::read(&rollback).unwrap(), b"staged S");
            assert!(!staged.exists());
            assert!(!backup.exists());
        }

        #[test]
        fn documented_1175_and_1176_layouts_preserve_both_original_names() {
            for error_code in [
                ERROR_UNABLE_TO_REMOVE_REPLACED,
                ERROR_UNABLE_TO_MOVE_REPLACEMENT,
            ] {
                let directory = tempfile::tempdir().unwrap();
                let destination = directory.path().join("publication.hwpx");
                let staged = directory.path().join("staged-publication.hwpx");
                let backup = directory.path().join("confirmed-destination.bin");
                let rollback = directory.path().join("rollback-staged.bin");
                std::fs::write(&destination, b"confirmed A").unwrap();
                std::fs::write(&staged, b"staged S").unwrap();
                let expected = inspect(&destination, MAXIMUM).unwrap();
                let staged_identity = inspect(&staged, MAXIMUM).unwrap();

                assert_eq!(
                    reconcile_failed_replace(
                        error_code,
                        &staged,
                        &destination,
                        &backup,
                        &rollback,
                        MAXIMUM,
                        &expected,
                        &staged_identity,
                    ),
                    Err(AtomicOutputError::Io)
                );
                assert_eq!(std::fs::read(&destination).unwrap(), b"confirmed A");
                assert_eq!(std::fs::read(&staged).unwrap(), b"staged S");
                assert!(!backup.exists());
                assert!(!rollback.exists());
            }
        }

        #[test]
        fn documented_1177_layout_restores_backup_with_no_replace_handle_rename() {
            let directory = tempfile::tempdir().unwrap();
            let destination = directory.path().join("publication.hwpx");
            let staged = directory.path().join("staged-publication.hwpx");
            let backup = directory.path().join("confirmed-destination.bin");
            let rollback = directory.path().join("rollback-staged.bin");
            std::fs::write(&backup, b"confirmed A").unwrap();
            std::fs::write(&staged, b"staged S").unwrap();
            let expected = inspect(&backup, MAXIMUM).unwrap();
            let staged_identity = inspect(&staged, MAXIMUM).unwrap();

            assert_eq!(
                reconcile_failed_replace(
                    ERROR_UNABLE_TO_MOVE_REPLACEMENT_2,
                    &staged,
                    &destination,
                    &backup,
                    &rollback,
                    MAXIMUM,
                    &expected,
                    &staged_identity,
                ),
                Err(AtomicOutputError::Io)
            );
            assert_eq!(inspect(&destination, MAXIMUM).unwrap(), expected);
            assert_eq!(inspect(&staged, MAXIMUM).unwrap(), staged_identity);
            assert!(!backup.exists());
            assert!(!rollback.exists());
        }

        #[test]
        fn documented_1177_restore_refuses_a_concurrent_destination_claim() {
            let directory = tempfile::tempdir().unwrap();
            let destination = directory.path().join("publication.hwpx");
            let backup = directory.path().join("confirmed-destination.bin");
            std::fs::write(&destination, b"foreign C").unwrap();
            std::fs::write(&backup, b"confirmed A").unwrap();
            let backup_identity = inspect(&backup, MAXIMUM).unwrap();

            assert_eq!(
                restore_backup_without_replacement(
                    &backup,
                    &destination,
                    MAXIMUM,
                    &backup_identity,
                ),
                Err(AtomicOutputError::RecoveryRequired)
            );
            assert_eq!(std::fs::read(&destination).unwrap(), b"foreign C");
            assert_eq!(std::fs::read(&backup).unwrap(), b"confirmed A");
        }

        #[test]
        fn recovery_publish_is_verified_and_never_clobbers_an_existing_name() {
            let directory = tempfile::tempdir().unwrap();
            let source = directory.path().join("confirmed-destination.bin");
            let recovery = directory.path().join("publication.madi-recovery.hwpx");
            std::fs::write(&source, b"confirmed A").unwrap();
            let expected = inspect(&source, MAXIMUM).unwrap();

            let published = publish(&source, &recovery, MAXIMUM, &expected).unwrap();
            assert_eq!(published.byte_length, expected.byte_length);
            assert_eq!(published.sha256, expected.sha256);
            assert_eq!(std::fs::read(&recovery).unwrap(), b"confirmed A");

            assert_eq!(
                publish(&source, &recovery, MAXIMUM, &expected),
                Err(AtomicOutputError::RecoveryRequired)
            );
            assert_eq!(std::fs::read(&recovery).unwrap(), b"confirmed A");
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{AtomicOutputError, FileIdentity, RecoveryArtifact, RecoveryOutcome};
    use std::path::Path;

    pub(super) fn inspect(
        _path: &Path,
        _maximum_bytes: u64,
    ) -> Result<FileIdentity, AtomicOutputError> {
        Err(AtomicOutputError::Unsupported)
    }

    pub(super) fn publish(
        _source_path: &Path,
        _recovery_path: &Path,
        _maximum_bytes: u64,
        _expected: &FileIdentity,
    ) -> Result<FileIdentity, AtomicOutputError> {
        Err(AtomicOutputError::Unsupported)
    }

    pub(super) fn commit(
        _staged_path: &Path,
        _destination_path: &Path,
        _backup_path: &Path,
        _rollback_path: &Path,
        _maximum_bytes: u64,
        _expected: &FileIdentity,
        _staged_identity: &FileIdentity,
    ) -> Result<(FileIdentity, FileIdentity), AtomicOutputError> {
        Err(AtomicOutputError::Unsupported)
    }

    pub(super) fn recover(
        _staged_path: &Path,
        _destination_path: &Path,
        _backup_path: &Path,
        _rollback_path: &Path,
        _maximum_bytes: u64,
        _expected: &FileIdentity,
        _staged_identity: &FileIdentity,
    ) -> Result<(RecoveryOutcome, Option<RecoveryArtifact>), AtomicOutputError> {
        Err(AtomicOutputError::Unsupported)
    }
}
