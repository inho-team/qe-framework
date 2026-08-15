#define _DARWIN_C_SOURCE

#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct qe_dirfd_callback_set {
  int (*before)(const char *name);
  int (*after)(const char *name);
} qe_dirfd_callback_set;

typedef struct qe_dirfd_identity {
  unsigned long long dev;
  unsigned long long ino;
  unsigned long long uid;
  unsigned long long mode;
} qe_dirfd_identity;

typedef struct qe_dirfd_request {
  char role[32];
  char launch_uuid[64];
  char operation_uuid[64];
  long parent_pid;
  char transaction_record_sha256[65];
  char request_sha256[65];
  qe_dirfd_identity expected_parent;
  char source_sha256[65];
  char core_sha256[65];
  char operation[16];
  char temp_name[128];
  char final_name[128];
  char expected_temp[16];
  char expected_final[16];
  long content_length;
  char content_sha256[65];
  unsigned long long temp_dev;
  unsigned long long temp_ino;
  unsigned long long temp_size;
  unsigned long long temp_nlink;
  char temp_sha256[65];
} qe_dirfd_request;

typedef struct qe_dirfd_record {
  char schema[64];
  char launch_uuid[64];
  char saved_parent_path[256];
  char saved_parent_realpath[256];
  char temp_name[128];
  char final_name[128];
  qe_dirfd_identity saved_parent;
  long content_length;
  char content_sha256[65];
  char source_sha256[65];
  char core_sha256[65];
  char production_sha256[65];
  char request_digest[65];
  char sha256[65];
} qe_dirfd_record;

static qe_dirfd_callback_set g_callbacks = {0};

static int qe_dirfd_boundary(const char *site, const char *call, const char *phase) {
  char id[96];
  int length = snprintf(id, sizeof(id), "%s.%s.%s", site, call, phase);
  if (length < 0 || (size_t)length >= sizeof(id)) return EOVERFLOW;
  int (*callback)(const char *) = strcmp(phase, "before") == 0 ? g_callbacks.before : g_callbacks.after;
  return callback && callback(id) != 0 ? ECANCELED : 0;
}

static int qe_dirfd_track_after(const char *site, const char *call, int result, int saved_errno) {
  if (qe_dirfd_boundary(site, call, "after") != 0 && result >= 0) { errno = ECANCELED; return -1; }
  errno = saved_errno; return result;
}

static int qe_dirfd_tracked_fcntl(int fd, int command, const char *site) {
  if (qe_dirfd_boundary(site, "fcntl", "before") != 0) { errno = ECANCELED; return -1; }
  int result = fcntl(fd, command); return qe_dirfd_track_after(site, "fcntl", result, errno);
}
static int qe_dirfd_tracked_fstat(int fd, struct stat *st, const char *site) {
  if (qe_dirfd_boundary(site, "fstat", "before") != 0) { errno = ECANCELED; return -1; }
  int result = fstat(fd, st); return qe_dirfd_track_after(site, "fstat", result, errno);
}
static int qe_dirfd_tracked_fstatat(int fd, const char *name, struct stat *st, int flags, const char *site) {
  if (qe_dirfd_boundary(site, "fstatat", "before") != 0) { errno = ECANCELED; return -1; }
  int result = fstatat(fd, name, st, flags); return qe_dirfd_track_after(site, "fstatat", result, errno);
}
static int qe_dirfd_tracked_openat(int fd, const char *name, int flags, mode_t mode, const char *site) {
  if (qe_dirfd_boundary(site, "openat", "before") != 0) { errno = ECANCELED; return -1; }
  int result = openat(fd, name, flags, mode); return qe_dirfd_track_after(site, "openat", result, errno);
}
static ssize_t qe_dirfd_tracked_read(int fd, void *buffer, size_t length, const char *site) {
  if (qe_dirfd_boundary(site, "read", "before") != 0) { errno = ECANCELED; return -1; }
  ssize_t result = read(fd, buffer, length); int saved = errno;
  if (qe_dirfd_boundary(site, "read", "after") != 0 && result >= 0) { errno = ECANCELED; return -1; }
  errno = saved; return result;
}
static off_t qe_dirfd_tracked_lseek(int fd, off_t offset, int whence, const char *site) {
  if (qe_dirfd_boundary(site, "lseek", "before") != 0) { errno = ECANCELED; return -1; }
  off_t result = lseek(fd, offset, whence); int saved = errno;
  if (qe_dirfd_boundary(site, "lseek", "after") != 0 && result >= 0) { errno = ECANCELED; return -1; }
  errno = saved; return result;
}
static ssize_t qe_dirfd_tracked_write(int fd, const void *buffer, size_t length, const char *site) {
  if (qe_dirfd_boundary(site, "write", "before") != 0) { errno = ECANCELED; return -1; }
  ssize_t result = write(fd, buffer, length); int saved = errno;
  if (qe_dirfd_boundary(site, "write", "after") != 0 && result >= 0) { errno = ECANCELED; return -1; }
  errno = saved; return result;
}
static int qe_dirfd_tracked_fchmod(int fd, mode_t mode, const char *site) {
  if (qe_dirfd_boundary(site, "fchmod", "before") != 0) { errno = ECANCELED; return -1; }
  int result = fchmod(fd, mode); return qe_dirfd_track_after(site, "fchmod", result, errno);
}
static int qe_dirfd_tracked_fsync(int fd, const char *site, const char *kind) {
  if (qe_dirfd_boundary(site, kind, "before") != 0) { errno = ECANCELED; return -1; }
  int result = fsync(fd); return qe_dirfd_track_after(site, kind, result, errno);
}
static int qe_dirfd_tracked_close(int fd, const char *site) {
  if (qe_dirfd_boundary(site, "close", "before") != 0) { errno = ECANCELED; return -1; }
  int result = close(fd); return qe_dirfd_track_after(site, "close", result, errno);
}
static int qe_dirfd_tracked_linkat(int fd1, const char *name1, int fd2, const char *name2, const char *site) {
  if (qe_dirfd_boundary(site, "linkat", "before") != 0) { errno = ECANCELED; return -1; }
  int result = linkat(fd1, name1, fd2, name2, 0); return qe_dirfd_track_after(site, "linkat", result, errno);
}
static int qe_dirfd_tracked_unlinkat(int fd, const char *name, const char *site) {
  if (qe_dirfd_boundary(site, "unlinkat", "before") != 0) { errno = ECANCELED; return -1; }
  int result = unlinkat(fd, name, 0); return qe_dirfd_track_after(site, "unlinkat", result, errno);
}

static void qe_dirfd_signal_handler(int signo) {
  _exit(signo == SIGTERM ? 143 : 124);
}

int qe_dirfd_helper_install_handlers(void) {
  static int installed = 0;
  if (installed) return 0;
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = qe_dirfd_signal_handler;
  if (sigemptyset(&action.sa_mask) != 0) return errno;
  if (sigaction(SIGALRM, &action, NULL) != 0) return errno;
  if (sigaction(SIGTERM, &action, NULL) != 0) return errno;
  if (alarm(10) != 0) return EBUSY;
  installed = 1;
  return 0;
}

static int qe_dirfd_read_exact_fd(int fd, void *buffer, size_t length, const char *site) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = qe_dirfd_tracked_read(fd, (char *)buffer + offset, length - offset, site);
    if (count < 0) {
      if (errno == EINTR) continue;
      return errno;
    }
    if (count == 0) return EIO;
    offset += (size_t)count;
  }
  return 0;
}

static int qe_dirfd_read_to_end(int fd, char **buffer, size_t *length, const char *site) {
  struct stat st;
  if (qe_dirfd_tracked_fstat(fd, &st, site) != 0) return errno;
  if (!S_ISREG(st.st_mode) || st.st_size < 0 || st.st_size > (4 * 1024 * 1024)) return EINVAL;
  size_t size = (size_t)st.st_size;
  char *data = malloc(size + 1);
  if (!data) return ENOMEM;
  if (qe_dirfd_tracked_lseek(fd, 0, SEEK_SET, site) < 0) {
    int error = errno;
    free(data);
    return error;
  }
  int error = qe_dirfd_read_exact_fd(fd, data, size, site);
  if (error != 0) {
    free(data);
    return error;
  }
  char extra;
  ssize_t extra_count;
  do {
    extra_count = qe_dirfd_tracked_read(fd, &extra, 1, site);
  } while (extra_count < 0 && errno == EINTR);
  if (extra_count != 0) {
    free(data);
    return extra_count < 0 ? errno : EOVERFLOW;
  }
  data[size] = '\0';
  *buffer = data;
  *length = size;
  return 0;
}

static void qe_dirfd_sha256(const void *data, size_t length, char out[65]) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data, (CC_LONG)length, digest);
  for (size_t index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
    snprintf(out + (index * 2), 3, "%02x", digest[index]);
  }
  out[64] = '\0';
}

static int qe_dirfd_write_exact_fd(int fd, const void *buffer, size_t length, const char *site) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = qe_dirfd_tracked_write(fd, (const char *)buffer + offset, length - offset, site);
    if (count < 0) {
      if (errno == EINTR) continue;
      return errno;
    }
    if (count == 0) return EIO;
    offset += (size_t)count;
  }
  return 0;
}

static const char *qe_dirfd_expect(const char *p, const char *literal) {
  size_t length = strlen(literal);
  return strncmp(p, literal, length) == 0 ? p + length : NULL;
}

static const char *qe_dirfd_parse_quoted(const char *p, char *out, size_t cap) {
  size_t index = 0;
  while (*p && *p != '"') {
    if (*p == '\\') return NULL;
    if (index + 1 >= cap) return NULL;
    out[index++] = *p;
    p += 1;
  }
  if (*p != '"') return NULL;
  out[index] = '\0';
  return p + 1;
}

static const char *qe_dirfd_parse_number(const char *p, long *out) {
  char *end = NULL;
  errno = 0;
  long value = strtol(p, &end, 10);
  if (errno != 0 || end == p) return NULL;
  *out = value;
  return end;
}

static const char *qe_dirfd_parse_u64(const char *p, unsigned long long *out) {
  char *end = NULL;
  errno = 0;
  unsigned long long value = strtoull(p, &end, 10);
  if (errno != 0 || end == p) return NULL;
  *out = value;
  return end;
}

static const char *qe_dirfd_parse_identity(const char *p, qe_dirfd_identity *identity) {
  if (!(p = qe_dirfd_expect(p, "{\"dev\":"))) return NULL;
  if (!(p = qe_dirfd_parse_u64(p, &identity->dev))) return NULL;
  if (!(p = qe_dirfd_expect(p, ",\"ino\":"))) return NULL;
  if (!(p = qe_dirfd_parse_u64(p, &identity->ino))) return NULL;
  if (!(p = qe_dirfd_expect(p, ",\"uid\":"))) return NULL;
  if (!(p = qe_dirfd_parse_u64(p, &identity->uid))) return NULL;
  if (!(p = qe_dirfd_expect(p, ",\"mode\":"))) return NULL;
  if (!(p = qe_dirfd_parse_u64(p, &identity->mode))) return NULL;
  return qe_dirfd_expect(p, "}");
}

static const char *qe_dirfd_parse_expected_parent(const char *p, qe_dirfd_identity *identity) {
  return qe_dirfd_parse_identity(p, identity);
}

static const char *qe_dirfd_parse_request(const char *json, qe_dirfd_request *request) {
  if (!(json = qe_dirfd_expect(json, "{\"role\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, request->role, sizeof(request->role)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"launchUuid\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, request->launch_uuid, sizeof(request->launch_uuid)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"operationUuid\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, request->operation_uuid, sizeof(request->operation_uuid)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"parentPid\":"))) return NULL;
  if (!(json = qe_dirfd_parse_number(json, &request->parent_pid))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"transactionRecordSha256\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, request->transaction_record_sha256, sizeof(request->transaction_record_sha256)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"requestSha256\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, request->request_sha256, sizeof(request->request_sha256)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"expectedParent\":"))) return NULL;
  if (!(json = qe_dirfd_parse_expected_parent(json, &request->expected_parent))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"sourceSha256\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, request->source_sha256, sizeof(request->source_sha256)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"coreSha256\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, request->core_sha256, sizeof(request->core_sha256)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"operation\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, request->operation, sizeof(request->operation)))) return NULL;
  if (strcmp(request->operation, "inspect") == 0) {
    if (!(json = qe_dirfd_expect(json, ",\"tempName\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->temp_name, sizeof(request->temp_name)))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"finalName\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->final_name, sizeof(request->final_name)))) return NULL;
  } else if (strcmp(request->operation, "create-temp") == 0) {
    if (!(json = qe_dirfd_expect(json, ",\"tempName\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->temp_name, sizeof(request->temp_name)))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"expectedTemp\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->expected_temp, sizeof(request->expected_temp)))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"contentLength\":"))) return NULL;
    if (!(json = qe_dirfd_parse_number(json, &request->content_length))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"contentSha256\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->content_sha256, sizeof(request->content_sha256)))) return NULL;
  } else if (strcmp(request->operation, "fsync-temp") == 0) {
    if (!(json = qe_dirfd_expect(json, ",\"tempName\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->temp_name, sizeof(request->temp_name)))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempDev\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_dev))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempIno\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_ino))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempSize\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_size))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempNlink\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_nlink))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempSha256\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->temp_sha256, sizeof(request->temp_sha256)))) return NULL;
  } else if (strcmp(request->operation, "link-final") == 0) {
    if (!(json = qe_dirfd_expect(json, ",\"tempName\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->temp_name, sizeof(request->temp_name)))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"finalName\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->final_name, sizeof(request->final_name)))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"expectedFinal\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->expected_final, sizeof(request->expected_final)))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempDev\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_dev))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempIno\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_ino))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempSize\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_size))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempNlink\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_nlink))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempSha256\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->temp_sha256, sizeof(request->temp_sha256)))) return NULL;
  } else if (strcmp(request->operation, "unlink-temp") == 0) {
    if (!(json = qe_dirfd_expect(json, ",\"tempName\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->temp_name, sizeof(request->temp_name)))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"finalName\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->final_name, sizeof(request->final_name)))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempDev\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_dev))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempIno\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_ino))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempSize\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_size))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempNlink\":"))) return NULL;
    if (!(json = qe_dirfd_parse_u64(json, &request->temp_nlink))) return NULL;
    if (!(json = qe_dirfd_expect(json, ",\"tempSha256\":\""))) return NULL;
    if (!(json = qe_dirfd_parse_quoted(json, request->temp_sha256, sizeof(request->temp_sha256)))) return NULL;
  } else if (strcmp(request->operation, "fsync-dir") == 0) {
    /* no extra fields */
  } else {
    return NULL;
  }
  return qe_dirfd_expect(json, "}");
}

static const char *qe_dirfd_parse_record(const char *json, qe_dirfd_record *record) {
  if (!(json = qe_dirfd_expect(json, "{\"schema\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->schema, sizeof(record->schema)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"launchUuid\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->launch_uuid, sizeof(record->launch_uuid)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"savedParent\":"))) return NULL;
  if (!(json = qe_dirfd_expect(json, "{\"path\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->saved_parent_path, sizeof(record->saved_parent_path)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"realpath\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->saved_parent_realpath, sizeof(record->saved_parent_realpath)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"dev\":"))) return NULL;
  if (!(json = qe_dirfd_parse_u64(json, &record->saved_parent.dev))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"ino\":"))) return NULL;
  if (!(json = qe_dirfd_parse_u64(json, &record->saved_parent.ino))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"uid\":"))) return NULL;
  if (!(json = qe_dirfd_parse_u64(json, &record->saved_parent.uid))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"mode\":"))) return NULL;
  if (!(json = qe_dirfd_parse_u64(json, &record->saved_parent.mode))) return NULL;
  if (!(json = qe_dirfd_expect(json, "},"))) return NULL;
  if (!(json = qe_dirfd_expect(json, "\"names\":{\"temp\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->temp_name, sizeof(record->temp_name)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"final\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->final_name, sizeof(record->final_name)))) return NULL;
  if (!(json = qe_dirfd_expect(json, "},\"content\":{\"length\":"))) return NULL;
  if (!(json = qe_dirfd_parse_number(json, &record->content_length))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"sha256\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->content_sha256, sizeof(record->content_sha256)))) return NULL;
  if (!(json = qe_dirfd_expect(json, "},\"digests\":{\"source\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->source_sha256, sizeof(record->source_sha256)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"core\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->core_sha256, sizeof(record->core_sha256)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"production\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->production_sha256, sizeof(record->production_sha256)))) return NULL;
  if (!(json = qe_dirfd_expect(json, "},\"requestDigest\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->request_digest, sizeof(record->request_digest)))) return NULL;
  if (!(json = qe_dirfd_expect(json, ",\"sha256\":\""))) return NULL;
  if (!(json = qe_dirfd_parse_quoted(json, record->sha256, sizeof(record->sha256)))) return NULL;
  return qe_dirfd_expect(json, "}");
}

static int qe_dirfd_fstat_identity(int fd, qe_dirfd_identity *identity, const char *site) {
  struct stat st;
  if (qe_dirfd_tracked_fstat(fd, &st, site) != 0) return errno;
  identity->dev = (unsigned long long)st.st_dev;
  identity->ino = (unsigned long long)st.st_ino;
  identity->uid = (unsigned long long)st.st_uid;
  identity->mode = (unsigned long long)st.st_mode;
  return 0;
}

static int qe_dirfd_read_link_identity(int parent_fd, const char *name, qe_dirfd_identity *identity, struct stat *st, const char *site) {
  if (qe_dirfd_tracked_fstatat(parent_fd, name, st, AT_SYMLINK_NOFOLLOW, site) != 0) return errno;
  identity->dev = (unsigned long long)st->st_dev;
  identity->ino = (unsigned long long)st->st_ino;
  identity->uid = (unsigned long long)st->st_uid;
  identity->mode = (unsigned long long)st->st_mode;
  return 0;
}

static int qe_dirfd_validate_identity(qe_dirfd_identity expected, qe_dirfd_identity actual) {
  return expected.dev == actual.dev && expected.ino == actual.ino
    && expected.uid == actual.uid && expected.mode == actual.mode ? 0 : EINVAL;
}

static void qe_dirfd_request_fingerprint(const qe_dirfd_request *request, char out[65]) {
  char buffer[2048];
  int written = 0;
  if (strcmp(request->operation, "inspect") == 0) {
    written = snprintf(buffer, sizeof(buffer),
      "{\"role\":\"%s\",\"launchUuid\":\"%s\",\"operationUuid\":\"%s\",\"parentPid\":%ld,"
      "\"transactionRecordSha256\":\"%s\",\"expectedParent\":{\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu},"
      "\"sourceSha256\":\"%s\",\"coreSha256\":\"%s\",\"operation\":\"%s\",\"tempName\":\"%s\",\"finalName\":\"%s\"}",
      request->role, request->launch_uuid, request->operation_uuid, request->parent_pid, request->transaction_record_sha256,
      request->expected_parent.dev, request->expected_parent.ino, request->expected_parent.uid, request->expected_parent.mode,
      request->source_sha256, request->core_sha256, request->operation, request->temp_name, request->final_name);
  } else if (strcmp(request->operation, "create-temp") == 0) {
    written = snprintf(buffer, sizeof(buffer),
      "{\"role\":\"%s\",\"launchUuid\":\"%s\",\"operationUuid\":\"%s\",\"parentPid\":%ld,"
      "\"transactionRecordSha256\":\"%s\",\"expectedParent\":{\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu},"
      "\"sourceSha256\":\"%s\",\"coreSha256\":\"%s\",\"operation\":\"%s\",\"tempName\":\"%s\",\"expectedTemp\":\"%s\",\"contentLength\":%ld,\"contentSha256\":\"%s\"}",
      request->role, request->launch_uuid, request->operation_uuid, request->parent_pid, request->transaction_record_sha256,
      request->expected_parent.dev, request->expected_parent.ino, request->expected_parent.uid, request->expected_parent.mode,
      request->source_sha256, request->core_sha256, request->operation, request->temp_name, request->expected_temp, request->content_length, request->content_sha256);
  } else if (strcmp(request->operation, "fsync-temp") == 0) {
    written = snprintf(buffer, sizeof(buffer),
      "{\"role\":\"%s\",\"launchUuid\":\"%s\",\"operationUuid\":\"%s\",\"parentPid\":%ld,"
      "\"transactionRecordSha256\":\"%s\",\"expectedParent\":{\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu},"
      "\"sourceSha256\":\"%s\",\"coreSha256\":\"%s\",\"operation\":\"%s\",\"tempName\":\"%s\",\"tempDev\":%llu,\"tempIno\":%llu,\"tempSize\":%llu,\"tempNlink\":%llu,\"tempSha256\":\"%s\"}",
      request->role, request->launch_uuid, request->operation_uuid, request->parent_pid, request->transaction_record_sha256,
      request->expected_parent.dev, request->expected_parent.ino, request->expected_parent.uid, request->expected_parent.mode,
      request->source_sha256, request->core_sha256, request->operation, request->temp_name, request->temp_dev, request->temp_ino, request->temp_size, request->temp_nlink, request->temp_sha256);
  } else if (strcmp(request->operation, "link-final") == 0) {
    written = snprintf(buffer, sizeof(buffer),
      "{\"role\":\"%s\",\"launchUuid\":\"%s\",\"operationUuid\":\"%s\",\"parentPid\":%ld,"
      "\"transactionRecordSha256\":\"%s\",\"expectedParent\":{\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu},"
      "\"sourceSha256\":\"%s\",\"coreSha256\":\"%s\",\"operation\":\"%s\",\"tempName\":\"%s\",\"finalName\":\"%s\",\"expectedFinal\":\"%s\",\"tempDev\":%llu,\"tempIno\":%llu,\"tempSize\":%llu,\"tempNlink\":%llu,\"tempSha256\":\"%s\"}",
      request->role, request->launch_uuid, request->operation_uuid, request->parent_pid, request->transaction_record_sha256,
      request->expected_parent.dev, request->expected_parent.ino, request->expected_parent.uid, request->expected_parent.mode,
      request->source_sha256, request->core_sha256, request->operation, request->temp_name, request->final_name, request->expected_final,
      request->temp_dev, request->temp_ino, request->temp_size, request->temp_nlink, request->temp_sha256);
  } else if (strcmp(request->operation, "unlink-temp") == 0) {
    written = snprintf(buffer, sizeof(buffer),
      "{\"role\":\"%s\",\"launchUuid\":\"%s\",\"operationUuid\":\"%s\",\"parentPid\":%ld,"
      "\"transactionRecordSha256\":\"%s\",\"expectedParent\":{\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu},"
      "\"sourceSha256\":\"%s\",\"coreSha256\":\"%s\",\"operation\":\"%s\",\"tempName\":\"%s\",\"finalName\":\"%s\",\"tempDev\":%llu,\"tempIno\":%llu,\"tempSize\":%llu,\"tempNlink\":%llu,\"tempSha256\":\"%s\"}",
      request->role, request->launch_uuid, request->operation_uuid, request->parent_pid, request->transaction_record_sha256,
      request->expected_parent.dev, request->expected_parent.ino, request->expected_parent.uid, request->expected_parent.mode,
      request->source_sha256, request->core_sha256, request->operation, request->temp_name, request->final_name,
      request->temp_dev, request->temp_ino, request->temp_size, request->temp_nlink, request->temp_sha256);
  } else {
    written = snprintf(buffer, sizeof(buffer),
      "{\"role\":\"%s\",\"launchUuid\":\"%s\",\"operationUuid\":\"%s\",\"parentPid\":%ld,"
      "\"transactionRecordSha256\":\"%s\",\"expectedParent\":{\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu},"
      "\"sourceSha256\":\"%s\",\"coreSha256\":\"%s\",\"operation\":\"%s\"}",
      request->role, request->launch_uuid, request->operation_uuid, request->parent_pid, request->transaction_record_sha256,
      request->expected_parent.dev, request->expected_parent.ino, request->expected_parent.uid, request->expected_parent.mode,
      request->source_sha256, request->core_sha256, request->operation);
  }
  if (written < 0 || (size_t)written >= sizeof(buffer)) {
    out[0] = '\0';
    return;
  }
  qe_dirfd_sha256(buffer, (size_t)written, out);
}

static void qe_dirfd_record_fingerprint(const qe_dirfd_record *record, char out[65]) {
  char buffer[2048];
  int written = snprintf(buffer, sizeof(buffer),
    "{\"schema\":\"%s\",\"launchUuid\":\"%s\",\"savedParent\":{\"path\":\"%s\",\"realpath\":\"%s\",\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu},"
    "\"names\":{\"temp\":\"%s\",\"final\":\"%s\"},\"content\":{\"length\":%ld,\"sha256\":\"%s\"},"
    "\"digests\":{\"source\":\"%s\",\"core\":\"%s\",\"production\":\"%s\"},\"requestDigest\":\"%s\"}",
    record->schema, record->launch_uuid, record->saved_parent_path, record->saved_parent_realpath,
    record->saved_parent.dev, record->saved_parent.ino, record->saved_parent.uid, record->saved_parent.mode,
    record->temp_name, record->final_name, record->content_length, record->content_sha256,
    record->source_sha256, record->core_sha256, record->production_sha256, record->request_digest);
  if (written < 0 || (size_t)written >= sizeof(buffer)) {
    out[0] = '\0';
    return;
  }
  qe_dirfd_sha256(buffer, (size_t)written, out);
}

static void qe_dirfd_record_authority_fingerprint(const qe_dirfd_record *record, char out[65]) {
  char buffer[2048];
  int written = snprintf(buffer, sizeof(buffer),
    "[\"%s\",\"%s\",\"%s\",%llu,%llu,%llu,%llu,\"%s\",\"%s\",%ld,\"%s\",\"%s\",\"%s\",\"%s\"]",
    record->schema, record->launch_uuid, record->saved_parent_realpath,
    record->saved_parent.dev, record->saved_parent.ino, record->saved_parent.uid, record->saved_parent.mode,
    record->temp_name, record->final_name, record->content_length, record->content_sha256,
    record->source_sha256, record->core_sha256, record->production_sha256);
  if (written < 0 || (size_t)written >= sizeof(buffer)) { out[0] = '\0'; return; }
  qe_dirfd_sha256(buffer, (size_t)written, out);
}

static int qe_dirfd_emit_response(int fd, const char *schema, const char *op, int committed, int err,
  qe_dirfd_identity parent, const char *temp_name, qe_dirfd_identity temp, const char *temp_sha,
  unsigned long long temp_size, unsigned long long temp_nlink,
  const char *final_name, qe_dirfd_identity final, const char *request_digest,
  const char *record_digest, const char *source_sha, const char *core_sha) {
  char buffer[2048];
  int written = snprintf(buffer, sizeof(buffer),
    "{\"schema\":\"%s\",\"op\":\"%s\",\"committed\":%s,\"errno\":%d,"
    "\"requestDigest\":\"%s\",\"transactionRecordSha256\":\"%s\","
    "\"sourceSha256\":\"%s\",\"coreSha256\":\"%s\","
    "\"parent\":{\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu},"
    "\"temp\":{\"name\":\"%s\",\"dev\":%llu,\"ino\":%llu,\"size\":%llu,\"nlink\":%llu,\"sha256\":\"%s\"},"
    "\"final\":{\"name\":\"%s\",\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu}}\n",
    schema, op, committed ? "true" : "false", err,
    request_digest, record_digest, source_sha, core_sha,
    parent.dev, parent.ino, parent.uid, parent.mode,
    temp_name, temp.dev, temp.ino, temp_size, temp_nlink, temp_sha,
    final_name, final.dev, final.ino, final.uid, final.mode);
  if (written < 0 || (size_t)written >= sizeof(buffer)) return EOVERFLOW;
  char site[48]; snprintf(site, sizeof(site), "%s.response", op);
  return qe_dirfd_write_exact_fd(fd, buffer, (size_t)written, site);
}

static int qe_dirfd_emit_inspect_response(int fd, const qe_dirfd_request *request, qe_dirfd_identity parent,
  const char *temp_status, qe_dirfd_identity temp, unsigned long long temp_size, unsigned long long temp_nlink, const char *temp_sha,
  const char *final_status, qe_dirfd_identity final, unsigned long long final_size, unsigned long long final_nlink, const char *final_sha) {
  char buffer[2304];
  int written = snprintf(buffer, sizeof(buffer),
    "{\"schema\":\"qe-dirfd-native-response-v1\",\"op\":\"inspect\",\"committed\":false,\"errno\":0,"
    "\"requestDigest\":\"%s\",\"transactionRecordSha256\":\"%s\",\"sourceSha256\":\"%s\",\"coreSha256\":\"%s\","
    "\"parent\":{\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu},"
    "\"temp\":{\"name\":\"%s\",\"status\":\"%s\",\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu,\"size\":%llu,\"nlink\":%llu,\"sha256\":\"%s\"},"
    "\"final\":{\"name\":\"%s\",\"status\":\"%s\",\"dev\":%llu,\"ino\":%llu,\"uid\":%llu,\"mode\":%llu,\"size\":%llu,\"nlink\":%llu,\"sha256\":\"%s\"}}\n",
    request->request_sha256, request->transaction_record_sha256, request->source_sha256, request->core_sha256,
    parent.dev, parent.ino, parent.uid, parent.mode,
    request->temp_name, temp_status, temp.dev, temp.ino, temp.uid, temp.mode, temp_size, temp_nlink, temp_sha,
    request->final_name, final_status, final.dev, final.ino, final.uid, final.mode, final_size, final_nlink, final_sha);
  if (written < 0 || (size_t)written >= sizeof(buffer)) return EOVERFLOW;
  return qe_dirfd_write_exact_fd(fd, buffer, (size_t)written, "inspect.response");
}

static int qe_dirfd_inspect_name(const char *name, qe_dirfd_identity *identity, unsigned long long *size,
  unsigned long long *nlink, char digest[65], const char *site) {
  struct stat path_st;
  if (qe_dirfd_tracked_fstatat(3, name, &path_st, AT_SYMLINK_NOFOLLOW, site) != 0) return errno;
  identity->dev = (unsigned long long)path_st.st_dev; identity->ino = (unsigned long long)path_st.st_ino;
  identity->uid = (unsigned long long)path_st.st_uid; identity->mode = (unsigned long long)path_st.st_mode;
  *size = (unsigned long long)path_st.st_size; *nlink = (unsigned long long)path_st.st_nlink;
  if (!S_ISREG(path_st.st_mode)) return EFTYPE;
  int opened = qe_dirfd_tracked_openat(3, name, O_RDONLY | O_NOFOLLOW, 0, site);
  if (opened < 0) return errno;
  struct stat opened_st;
  if (qe_dirfd_tracked_fstat(opened, &opened_st, site) != 0 || opened_st.st_dev != path_st.st_dev || opened_st.st_ino != path_st.st_ino) {
    qe_dirfd_tracked_close(opened, site); return EINVAL;
  }
  char *data = NULL; size_t length = 0;
  int error = qe_dirfd_read_to_end(opened, &data, &length, site);
  if (qe_dirfd_tracked_close(opened, site) != 0 && error == 0) error = errno;
  if (error != 0) { free(data); return error; }
  qe_dirfd_sha256(data, length, digest); free(data); return 0;
}

static int qe_dirfd_verify_common(const qe_dirfd_request *request, const qe_dirfd_record *record, int parent_fd, qe_dirfd_identity *parent_identity) {
  if (!request || !record) return EINVAL;
  if (strcmp(request->role, "qe-dirfd-helper") != 0) return EINVAL;
  if (strcmp(record->schema, "qe-dirfd-transaction-record-v1") != 0) return EINVAL;
  if (strcmp(request->launch_uuid, record->launch_uuid) != 0) return EINVAL;
  if (strcmp(request->source_sha256, record->source_sha256) != 0) return EINVAL;
  if (strcmp(request->core_sha256, record->core_sha256) != 0) return EINVAL;
  if (strcmp(request->transaction_record_sha256, record->sha256) != 0) return EINVAL;
  if (request->parent_pid != (long)getppid()) return EINVAL;
  if (request->expected_parent.dev != record->saved_parent.dev
    || request->expected_parent.ino != record->saved_parent.ino
    || request->expected_parent.uid != record->saved_parent.uid
    || request->expected_parent.mode != record->saved_parent.mode) return EINVAL;
  if (qe_dirfd_fstat_identity(parent_fd, parent_identity, "common.parent") != 0) return errno;
  if (!S_ISDIR((mode_t)parent_identity->mode)) return ENOTDIR;
  if (qe_dirfd_validate_identity(request->expected_parent, *parent_identity) != 0) return EINVAL;
  if (request->request_sha256[0] == '\0') return EINVAL;
  if (strcmp(request->temp_name, record->temp_name) != 0 && strcmp(request->operation, "fsync-dir") != 0) return EINVAL;
  if ((strcmp(request->operation, "inspect") == 0 || strcmp(request->operation, "link-final") == 0
      || strcmp(request->operation, "unlink-temp") == 0) && strcmp(request->final_name, record->final_name) != 0) return EINVAL;
  if (strcmp(request->operation, "create-temp") == 0
      && (request->content_length != record->content_length || strcmp(request->content_sha256, record->content_sha256) != 0)) return EINVAL;
  return 0;
}

static int qe_dirfd_finish_create_temp(const qe_dirfd_request *request, int parent_fd, qe_dirfd_identity parent_identity, const char *content, size_t length) {
  (void)parent_fd;
  int fd = qe_dirfd_tracked_openat(3, request->temp_name, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600, "create-temp.file");
  if (fd < 0) return errno;
  int error = qe_dirfd_write_exact_fd(fd, content, length, "create-temp.content-write");
  if (error != 0) {
    qe_dirfd_tracked_close(fd, "create-temp.file");
    return error;
  }
  if (qe_dirfd_tracked_fchmod(fd, 0600, "create-temp.file") != 0) {
    error = errno;
    qe_dirfd_tracked_close(fd, "create-temp.file");
    return error;
  }
  struct stat st;
  if (qe_dirfd_tracked_fstat(fd, &st, "create-temp.file") != 0) {
    error = errno;
    qe_dirfd_tracked_close(fd, "create-temp.file");
    return error;
  }
  if ((unsigned long long)st.st_size != (unsigned long long)request->content_length) {
    qe_dirfd_tracked_close(fd, "create-temp.file");
    return EINVAL;
  }
  error = qe_dirfd_tracked_fsync(fd, "create-temp.file", "file-fsync") != 0 ? errno : 0;
  qe_dirfd_tracked_close(fd, "create-temp.file");
  if (error != 0) return error;
  qe_dirfd_identity temp = { (unsigned long long)st.st_dev, (unsigned long long)st.st_ino, (unsigned long long)st.st_uid, (unsigned long long)st.st_mode };
  qe_dirfd_identity final = {0, 0, 0, 0};
  return qe_dirfd_emit_response(1, "qe-dirfd-native-response-v1", "create-temp", 1, 0, parent_identity,
    request->temp_name, temp, request->content_sha256, (unsigned long long)st.st_size, (unsigned long long)st.st_nlink,
    request->final_name, final, request->request_sha256, request->transaction_record_sha256,
    request->source_sha256, request->core_sha256);
}

static int qe_dirfd_finish_simple_response(const qe_dirfd_request *request, int parent_fd, qe_dirfd_identity parent_identity,
  const char *op, const char *temp_name, const char *temp_sha, unsigned long long temp_size, unsigned long long temp_nlink,
  const char *final_name, qe_dirfd_identity temp, qe_dirfd_identity final) {
  (void)parent_fd;
  return qe_dirfd_emit_response(1, "qe-dirfd-native-response-v1", op, 1, 0, parent_identity,
    temp_name, temp, temp_sha, temp_size, temp_nlink, final_name, final,
    request->request_sha256, request->transaction_record_sha256, request->source_sha256, request->core_sha256);
}

static int qe_dirfd_run_operation(const qe_dirfd_request *request, const qe_dirfd_record *record, int parent_fd, int record_fd, int content_fd, int response_fd) {
  (void)record_fd;
  qe_dirfd_identity parent_identity;
  int error = qe_dirfd_verify_common(request, record, parent_fd, &parent_identity);
  if (error != 0) return error;
  if (strcmp(request->operation, "create-temp") == 0) {
    char *content = NULL;
    size_t length = 0;
    error = qe_dirfd_read_to_end(content_fd, &content, &length, "create-temp.content-read");
    if (error != 0) return error;
    if ((long)length != request->content_length) {
      free(content);
      return EINVAL;
    }
    char digest[65];
    qe_dirfd_sha256(content, length, digest);
    if (strcmp(digest, request->content_sha256) != 0) {
      free(content);
      return EINVAL;
    }
    error = qe_dirfd_finish_create_temp(request, parent_fd, parent_identity, content, length);
    free(content);
    return error;
  }
  if (strcmp(request->operation, "fsync-temp") == 0) {
    struct stat st;
    qe_dirfd_identity temp_identity;
    error = qe_dirfd_read_link_identity(3, request->temp_name, &temp_identity, &st, "fsync-temp.path");
    if (error != 0) return error;
    if (!S_ISREG(st.st_mode)) return EINVAL;
    if ((unsigned long long)st.st_dev != request->temp_dev || (unsigned long long)st.st_ino != request->temp_ino
        || (unsigned long long)st.st_size != request->temp_size || (unsigned long long)st.st_nlink != request->temp_nlink) return EINVAL;
    int fd = qe_dirfd_tracked_openat(3, request->temp_name, O_RDONLY | O_NOFOLLOW, 0, "fsync-temp.file");
    if (fd < 0) return errno;
    struct stat opened_st;
    if (qe_dirfd_tracked_fstat(fd, &opened_st, "fsync-temp.file") != 0 || opened_st.st_dev != st.st_dev || opened_st.st_ino != st.st_ino
        || opened_st.st_size != st.st_size || opened_st.st_nlink != st.st_nlink) { qe_dirfd_tracked_close(fd, "fsync-temp.file"); return EINVAL; }
    char *data = NULL;
    size_t length = 0;
    error = qe_dirfd_read_to_end(fd, &data, &length, "fsync-temp.data-read");
    if (error != 0) { qe_dirfd_tracked_close(fd, "fsync-temp.file"); return error; }
    char digest[65];
    qe_dirfd_sha256(data, length, digest);
    free(data);
    if (strcmp(digest, request->temp_sha256) != 0) { qe_dirfd_tracked_close(fd, "fsync-temp.file"); return EINVAL; }
    if (qe_dirfd_tracked_fsync(fd, "fsync-temp.file", "file-fsync") != 0) { error = errno; qe_dirfd_tracked_close(fd, "fsync-temp.file"); return error; }
    if (qe_dirfd_tracked_close(fd, "fsync-temp.file") != 0) return errno;
    qe_dirfd_identity final_identity = {0, 0, 0, 0};
    return qe_dirfd_finish_simple_response(request, parent_fd, parent_identity, "fsync-temp",
      request->temp_name, digest, (unsigned long long)st.st_size, (unsigned long long)st.st_nlink,
      request->final_name, temp_identity, final_identity);
  }
  if (strcmp(request->operation, "link-final") == 0) {
    struct stat temp_st;
    qe_dirfd_identity temp_identity;
    error = qe_dirfd_read_link_identity(3, request->temp_name, &temp_identity, &temp_st, "link-final.temp-path");
    if (error != 0) return error;
    if ((unsigned long long)temp_st.st_ino != request->temp_ino || (unsigned long long)temp_st.st_dev != request->temp_dev) return EINVAL;
    if ((unsigned long long)temp_st.st_nlink != request->temp_nlink || (unsigned long long)temp_st.st_size != request->temp_size) return EINVAL;
    int verify_fd = qe_dirfd_tracked_openat(3, request->temp_name, O_RDONLY | O_NOFOLLOW, 0, "link-final.file");
    if (verify_fd < 0) return errno;
    char *verify_data = NULL; size_t verify_length = 0; char verify_digest[65];
    error = qe_dirfd_read_to_end(verify_fd, &verify_data, &verify_length, "link-final.data-read");
    if (qe_dirfd_tracked_close(verify_fd, "link-final.file") != 0 && error == 0) error = errno;
    if (error != 0) { free(verify_data); return error; }
    qe_dirfd_sha256(verify_data, verify_length, verify_digest); free(verify_data);
    if (strcmp(verify_digest, request->temp_sha256) != 0) return EINVAL;
    struct stat absent_st;
    if (qe_dirfd_tracked_fstatat(3, request->final_name, &absent_st, AT_SYMLINK_NOFOLLOW, "link-final.final-absent") == 0 || errno != ENOENT) return EINVAL;
    if (qe_dirfd_tracked_linkat(3, request->temp_name, 3, request->final_name, "link-final.commit") != 0) return errno;
    qe_dirfd_identity final_identity;
    struct stat final_st;
    error = qe_dirfd_read_link_identity(3, request->final_name, &final_identity, &final_st, "link-final.post-path");
    if (error != 0) return error;
    if ((unsigned long long)final_st.st_ino != request->temp_ino || (unsigned long long)final_st.st_dev != request->temp_dev) return EINVAL;
    return qe_dirfd_emit_response(response_fd, "qe-dirfd-native-response-v1", "link-final", 1, 0, parent_identity,
      request->temp_name, temp_identity, request->temp_sha256, (unsigned long long)temp_st.st_size, (unsigned long long)temp_st.st_nlink,
      request->final_name, final_identity, request->request_sha256, request->transaction_record_sha256,
      request->source_sha256, request->core_sha256);
  }
  if (strcmp(request->operation, "unlink-temp") == 0) {
    struct stat temp_st;
    qe_dirfd_identity temp_identity;
    error = qe_dirfd_read_link_identity(3, request->temp_name, &temp_identity, &temp_st, "unlink-temp.temp-path");
    if (error != 0) return error;
    if ((unsigned long long)temp_st.st_ino != request->temp_ino || (unsigned long long)temp_st.st_dev != request->temp_dev) return EINVAL;
    if ((unsigned long long)temp_st.st_nlink != request->temp_nlink || (unsigned long long)temp_st.st_size != request->temp_size) return EINVAL;
    int verify_fd = qe_dirfd_tracked_openat(3, request->temp_name, O_RDONLY | O_NOFOLLOW, 0, "unlink-temp.file");
    if (verify_fd < 0) return errno;
    char *verify_data = NULL; size_t verify_length = 0; char verify_digest[65];
    error = qe_dirfd_read_to_end(verify_fd, &verify_data, &verify_length, "unlink-temp.data-read");
    if (qe_dirfd_tracked_close(verify_fd, "unlink-temp.file") != 0 && error == 0) error = errno;
    if (error != 0) { free(verify_data); return error; }
    qe_dirfd_sha256(verify_data, verify_length, verify_digest); free(verify_data);
    if (strcmp(verify_digest, request->temp_sha256) != 0) return EINVAL;
    struct stat pre_final_st;
    if (qe_dirfd_tracked_fstatat(3, request->final_name, &pre_final_st, AT_SYMLINK_NOFOLLOW, "unlink-temp.final-path") != 0
        || pre_final_st.st_dev != temp_st.st_dev || pre_final_st.st_ino != temp_st.st_ino
        || pre_final_st.st_nlink != 2 || pre_final_st.st_size != temp_st.st_size) return EINVAL;
    if (qe_dirfd_tracked_unlinkat(3, request->temp_name, "unlink-temp.commit") != 0) return errno;
    qe_dirfd_identity final_identity;
    struct stat final_st;
    error = qe_dirfd_read_link_identity(3, request->final_name, &final_identity, &final_st, "unlink-temp.post-path");
    if (error != 0) return error;
    return qe_dirfd_emit_response(response_fd, "qe-dirfd-native-response-v1", "unlink-temp", 1, 0, parent_identity,
      request->temp_name, temp_identity, request->temp_sha256, (unsigned long long)temp_st.st_size, (unsigned long long)temp_st.st_nlink,
      request->final_name, final_identity, request->request_sha256, request->transaction_record_sha256,
      request->source_sha256, request->core_sha256);
  }
  if (strcmp(request->operation, "fsync-dir") == 0) {
    if (qe_dirfd_tracked_fsync(3, "fsync-dir.parent", "dir-fsync") != 0) return errno;
    qe_dirfd_identity zero = {0, 0, 0, 0};
    return qe_dirfd_emit_response(response_fd, "qe-dirfd-native-response-v1", "fsync-dir", 1, 0, parent_identity,
      request->temp_name, zero, "", 0, 0, request->final_name, zero, request->request_sha256,
      request->transaction_record_sha256, request->source_sha256, request->core_sha256);
  }
  if (strcmp(request->operation, "inspect") == 0) {
    qe_dirfd_identity temp_identity = {0, 0, 0, 0};
    qe_dirfd_identity final_identity = {0, 0, 0, 0};
    unsigned long long temp_size = 0, temp_nlink = 0, final_size = 0, final_nlink = 0;
    char temp_digest[65] = "", final_digest[65] = "";
    int temp_error = qe_dirfd_inspect_name(request->temp_name, &temp_identity, &temp_size, &temp_nlink, temp_digest, "inspect.temp");
    int final_error = qe_dirfd_inspect_name(request->final_name, &final_identity, &final_size, &final_nlink, final_digest, "inspect.final");
    const char *temp_status = temp_error == ENOENT ? "absent" : temp_error != 0 ? "foreign"
      : temp_size != (unsigned long long)record->content_length ? "partial"
      : strcmp(temp_digest, record->content_sha256) == 0 ? "exact" : "mismatch";
    const char *final_status = final_error == ENOENT ? "absent" : final_error != 0 ? "foreign"
      : final_size != (unsigned long long)record->content_length || strcmp(final_digest, record->content_sha256) != 0 ? "mismatch"
      : "exact";
    if (strcmp(temp_status, "exact") == 0 && strcmp(final_status, "exact") == 0
        && temp_identity.dev == final_identity.dev && temp_identity.ino == final_identity.ino && temp_nlink == 2 && final_nlink == 2) {
      final_status = "exact-same-inode";
    } else if (strcmp(temp_status, "absent") == 0 && strcmp(final_status, "exact") == 0 && final_nlink == 1) {
      final_status = "exact-nlink1";
    }
    return qe_dirfd_emit_inspect_response(response_fd, request, parent_identity,
      temp_status, temp_identity, temp_size, temp_nlink, temp_digest,
      final_status, final_identity, final_size, final_nlink, final_digest);
  }
  return EINVAL;
}

static int qe_dirfd_load_request_and_record(qe_dirfd_request *request, qe_dirfd_record *record, const char *request_json, size_t request_length, const char *record_json, size_t record_length) {
  const char *request_end = qe_dirfd_parse_request(request_json, request);
  const char *record_end = qe_dirfd_parse_record(record_json, record);
  if (!request_end || *request_end != '\0') return EINVAL;
  if (!record_end || *record_end != '\0') return EINVAL;
  char computed_request[65];
  char computed_record[65];
  char computed_authority[65];
  qe_dirfd_request_fingerprint(request, computed_request);
  qe_dirfd_record_fingerprint(record, computed_record);
  qe_dirfd_record_authority_fingerprint(record, computed_authority);
  if (strcmp(computed_request, request->request_sha256) != 0) return EINVAL;
  if (strcmp(computed_record, record->sha256) != 0) return EINVAL;
  if (strcmp(computed_authority, record->request_digest) != 0) return EINVAL;
  if (request_length == 0 || record_length == 0) return EINVAL;
  return 0;
}

static int qe_dirfd_argv_matches_request(int argc, char **argv, const qe_dirfd_request *request) {
  char number[64];
  if (argc != 15 || strcmp(argv[1], request->role) != 0 || strcmp(argv[2], request->launch_uuid) != 0
      || strcmp(argv[3], request->operation_uuid) != 0) return EINVAL;
  snprintf(number, sizeof(number), "%ld", request->parent_pid); if (strcmp(argv[4], number) != 0) return EINVAL;
  if (strcmp(argv[5], request->transaction_record_sha256) != 0 || strcmp(argv[6], request->request_sha256) != 0) return EINVAL;
  snprintf(number, sizeof(number), "%llu", request->expected_parent.dev); if (strcmp(argv[7], number) != 0) return EINVAL;
  snprintf(number, sizeof(number), "%llu", request->expected_parent.ino); if (strcmp(argv[8], number) != 0) return EINVAL;
  snprintf(number, sizeof(number), "%llu", request->expected_parent.uid); if (strcmp(argv[9], number) != 0) return EINVAL;
  snprintf(number, sizeof(number), "%llu", request->expected_parent.mode); if (strcmp(argv[10], number) != 0) return EINVAL;
  if (strcmp(argv[11], request->source_sha256) != 0 || strcmp(argv[12], request->core_sha256) != 0
      || strcmp(argv[13], request->operation) != 0) return EINVAL;
  return 0;
}

int qe_dirfd_helper_set_callbacks(qe_dirfd_callback_set callbacks) {
  g_callbacks = callbacks;
  return 0;
}

int qe_dirfd_helper_entry_production(int argc, char **argv) {
  if (qe_dirfd_helper_install_handlers() != 0) return 70;
  if (argc != 15) return 64;
  if (strcmp(argv[1], "qe-dirfd-helper") != 0) return 64;
  int parent_fd = 3;
  int content_fd = 4;
  int record_fd = 7;
  if (qe_dirfd_tracked_fcntl(parent_fd, F_GETFD, "startup.parent") < 0) return 64;
  if (qe_dirfd_tracked_fcntl(record_fd, F_GETFD, "startup.record") < 0) return 64;
  if (strcmp(argv[13], "create-temp") == 0 && qe_dirfd_tracked_fcntl(content_fd, F_GETFD, "startup.content") < 0) return 64;
  if (strcmp(argv[13], "create-temp") != 0) {
    if (qe_dirfd_tracked_fcntl(content_fd, F_GETFD, "startup.content-absent") >= 0 || errno != EBADF) return 64;
  }
  char *request_json = argv[14];
  char *record_json = NULL;
  qe_dirfd_request request;
  qe_dirfd_record record;
  memset(&request, 0, sizeof(request));
  memset(&record, 0, sizeof(record));
  char *record_blob = NULL;
  size_t request_length = strlen(request_json);
  size_t record_length = 0;
  if (qe_dirfd_read_to_end(record_fd, &record_blob, &record_length, "startup.record-read") != 0) return 64;
  if (record_length < 2 || record_blob[record_length - 1] != '\n' || memchr(record_blob, '\n', record_length - 1) != NULL) {
    free(record_blob);
    return 64;
  }
  record_blob[--record_length] = '\0';
  record_json = record_blob;
  if (qe_dirfd_load_request_and_record(&request, &record, request_json, request_length, record_json, record_length) != 0) {
    free(record_blob);
    return 64;
  }
  if (qe_dirfd_argv_matches_request(argc, argv, &request) != 0) {
    free(record_blob);
    return 64;
  }
  qe_dirfd_identity parent_identity;
  if (qe_dirfd_fstat_identity(parent_fd, &parent_identity, "startup.parent-identity") != 0) {
    free(record_blob);
    return 64;
  }
  if (qe_dirfd_validate_identity((qe_dirfd_identity){record.saved_parent.dev, record.saved_parent.ino, record.saved_parent.uid, record.saved_parent.mode}, parent_identity) != 0) {
    free(record_blob);
    return 64;
  }
  int result = qe_dirfd_run_operation(&request, &record, parent_fd, record_fd, content_fd, 1);
  free(record_blob);
  return result == 0 ? 0 : result;
}
