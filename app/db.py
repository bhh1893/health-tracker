from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

# open=False: the app can start (and pass liveness) even if Postgres is down.
# The pool is opened in the FastAPI lifespan and reconnects in the background.
# dict_row: rows come back as dicts ({"id": ..., "name": ...}) instead of tuples.
# timeout=5: a request waits at most 5s for a connection, then fails fast.
pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=5,
    open=False,
    timeout=5,
    kwargs={"row_factory": dict_row},
)
