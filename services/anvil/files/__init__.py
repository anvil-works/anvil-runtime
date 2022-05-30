import anvil

if not anvil.is_server_side():
    raise Exception("anvil.files cannot be imported on the client side.")

import anvil.server
import anvil.media
from anvil.tables.v2 import app_tables
from tempfile import gettempdir, mkdtemp
import os
import shutil
import sqlite3
from time import time, sleep
from contextlib import contextmanager
from uuid import uuid4
import logging
import sys

logger = logging.getLogger(__name__)

handler = logging.StreamHandler(stream=sys.stdout)
formatter = logging.Formatter(
    '[%(name)s %(levelname)s] %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)


def enable_debug_logging():
    logger.setLevel(logging.DEBUG)


MAX_REMOTE_METADATA_AGE = 5
DOWNLOAD_TIMEOUT = 5
FILES_TABLE = getattr(app_tables, "files") # TODO: Get table name from server config

class Files(object):

    def __init__(self):
        self._table_id = FILES_TABLE._id # TODO: Switch to .id when it works
        self._temp_dir = os.path.join(gettempdir(), "anvil-data-files")
        try:
            os.makedirs(self._temp_dir)
        except OSError:
            pass
        self._cache_dir = os.path.join(self._temp_dir, "table-%s" % self._table_id)
        
        self._db_path = os.path.join(self._temp_dir, "anvil-data-files-metadata.db")
        db = self._get_db()
        cur = db.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS tables (table_id PRIMARY KEY, last_fetched)")
        cur.execute("CREATE TABLE IF NOT EXISTS local_files (table_id, path, local_file_version, status, remote_file_version, last_touched, PRIMARY KEY (table_id, path) on conflict fail)")
        cur.execute("CREATE TABLE IF NOT EXISTS remote_files (table_id, path, file_version, PRIMARY KEY (table_id, path))")
        db.commit()

    def _get_db(self):
        db = sqlite3.connect(self._db_path)
        db.row_factory = sqlite3.Row
        return db

    def download(self, db, remote_file_metadata):
        path = remote_file_metadata['path']
        local_file_path = os.path.join(self._cache_dir, path)
        file_version = remote_file_metadata['file_version']
        logger.debug("Downloading %s" % path)
        db.execute("UPDATE local_files SET status='DOWNLOADING', local_file_version = NULL, remote_file_version = ?, last_touched = ? WHERE table_id = ? AND path = ?",
                    [file_version, time(), self._table_id, path])
        db.commit()
        remote_file_row = FILES_TABLE.get(path=path)
        d = mkdtemp()
        try:
            tempname = os.path.join(d, '%s.anvildownload' % path)
            try:
                os.makedirs(os.path.dirname(tempname))
            except OSError:
                pass
            logger.debug("Downloading to %s" % tempname)
            with open(tempname, 'wb+') as f:
                # TODO: Periodically update last_touched while downloading
                if remote_file_row['file']:
                    f.write(remote_file_row['file'].get_bytes())

            try:
                os.makedirs(os.path.dirname(local_file_path))
            except OSError:
                pass
            os.rename(tempname, local_file_path)
        finally:
            shutil.rmtree(d, ignore_errors=True)

        logger.debug("Downloaded %s to %s" % (path, local_file_path))

        db.execute("UPDATE local_files SET status='PRESENT', local_file_version = ?, last_touched = ? WHERE table_id = ? AND path = ?",
                    [file_version, time(), self._table_id, path])
        db.commit()

    def upload(self, db, path):
        # TODO: Cope with new files?
        file_row = FILES_TABLE.get(path=path)
        local_file_path = os.path.join(self._cache_dir, path)
        logger.debug("Uploading %s" % path)
        db.execute("UPDATE local_files SET status='UPLOADING', last_touched=? WHERE table_id=? AND path=?", [time(), self._table_id, path])
        db.commit()
        file_row['file'] = anvil.media.from_file(local_file_path) # TODO: MIME type? Store in metadata?
        new_file_version = str(uuid4()) # TODO: Proper content hash
        file_row['file_version'] = new_file_version
        logger.debug("Uploaded %s" % path)
        db.execute("UPDATE remote_files SET file_version=? WHERE table_id=? AND path=?", [new_file_version, self._table_id, path])
        db.commit()
        db.execute("UPDATE local_files SET status='PRESENT', last_touched=?, local_file_version=?, remote_file_version=? WHERE table_id=? AND path=?", [time(), new_file_version, new_file_version, self._table_id, path])
        db.commit()


    def __getitem__(self, path):
        db = self._get_db()
        cur = db.cursor()
        local_path = os.path.join(self._cache_dir, path)

        # Fetch and possibly upsert remote table metadata into local DB.
        cur.execute("SELECT * FROM tables WHERE table_id = ?", [self._table_id])
        table_metadata = cur.fetchone()
        if table_metadata is None or time() - table_metadata['last_fetched'] > MAX_REMOTE_METADATA_AGE:
            logger.debug("Fetching remote file metadata")
            db.execute("INSERT OR REPLACE INTO tables (table_id, last_fetched) VALUES (?, ?)", [self._table_id, time()])
            db.execute("DELETE FROM remote_files WHERE table_id = ?", [self._table_id])
            for file in FILES_TABLE.search():
                db.execute("INSERT INTO remote_files (table_id, path, file_version) VALUES (?, ?, ?)", [self._table_id, file['path'], file['file_version']])
            db.commit()

        # Fetch remote file metadata
        path = path.strip("/")
        path_like = "%s/%%" % path

        cur.execute("SELECT * FROM remote_files WHERE table_id = ? AND (path LIKE ? or path = ?) ORDER BY path = ?", [self._table_id, path_like, path, path])
        remote_files_metadata = cur.fetchall()

        if not remote_files_metadata:
            # Whatever we were looking for, it doesn't exist remotely. Remove matching local file/directory
            # Path might be a file:
            try:
                os.remove(os.path.join(self._cache_dir, path))
            except OSError:
                pass
            # Path might be a directory
            shutil.rmtree(os.path.join(self._cache_dir, path), ignore_errors=True)

            raise Exception("File not found: %s" % path)
        else:
            # We might have matched multiple remote files (if path is a directory)
            is_folder = len(remote_files_metadata) > 1
            for remote_file_metadata in remote_files_metadata:
                logger.debug("Loading file: %s" % remote_file_metadata['path'])
                if is_folder and remote_file_metadata['path'] == path:
                    logger.warning("Found file with same name as folder: %s" % path)
                    continue

                try:
                    db.execute("INSERT OR FAIL INTO local_files (table_id, path, remote_file_version, status) VALUES (?,?,?,'DOWNLOADING')", [self._table_id, remote_file_metadata['path'], remote_file_metadata['file_version']])
                    db.commit()
                    # We managed to insert the metadata, which means it didn't already exist. Download the file.
                    self.download(db, remote_file_metadata)

                except sqlite3.IntegrityError:
                    # The metadata exists, so fetch it.
                    cur.execute("SELECT * FROM local_files WHERE table_id = ? AND path = ?", [self._table_id, remote_file_metadata['path']])
                    local_file_metadata = cur.fetchone()

                    if local_file_metadata['status'] == 'DOWNLOADING':
                        logger.debug("File is already downloading")
                        while time() - local_file_metadata['last_touched'] < DOWNLOAD_TIMEOUT:
                            logger.debug("Waiting for download to finish")
                            # We haven't been downloading long. Wait and see.
                            sleep(0.5)
                            cur.execute("SELECT * FROM local_files WHERE table_id = ? AND path = ?", [self._table_id, remote_file_metadata['path']])
                            local_file_metadata = cur.fetchone()
                            if local_file_metadata['status'] == 'PRESENT':
                                logger.debug("Download finished elsewhere")
                                break
                        else:
                            # The download has probably stalled. Try again.
                            logger.debug("Previous download timed out")
                            self.download(db, remote_file_metadata)

                    elif local_file_metadata['status'] == 'UPLOADING':
                        logger.debug("Already uploading")
                        # TODO: Something?
                    elif local_file_metadata['status'] == 'PRESENT':
                        if local_file_metadata['local_file_version'] == remote_file_metadata['file_version']:
                            logger.debug("Found local cache")
                        else:
                            logger.debug("Local file cache has invalid hash.")
                            self.download(db, remote_file_metadata)

                    else:
                        raise Exception("Invalid local file status: %s" % local_file_metadata['status'])

            logger.debug("")
            logger.debug("TABLES")
            cur.execute("SELECT * FROM tables")
            for r in cur.fetchall():
                logger.debug(dict(r))
            logger.debug("REMOTE FILES")
            cur.execute("SELECT * FROM remote_files")
            for r in cur.fetchall():
                logger.debug(dict(r))

            logger.debug("LOCAL FILES")
            cur.execute("SELECT * FROM local_files")
            for r in cur.fetchall():
                logger.debug(dict(r))
            logger.debug("")

            return local_path

    def editing(self, path):
        local_path = self[path]
        db = self._get_db()
        table_id = self._table_id
        upload = self.upload

        class Editing():
            def __enter__(self):
                return local_path

            def __exit__(self, exc_type, exc_val, exc_tb):
                upload(db, path)

        return Editing()

    @contextmanager
    def open(self, path, mode='r'):
        with open(data_files[path], mode) as f:
            yield f
        if "w" in mode or "a" in mode or "+" in mode or "x":
            self.upload(self._get_db(), path)

data_files = Files()

