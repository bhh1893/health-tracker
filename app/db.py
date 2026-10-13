from psycopg_pool import ConnectionPool

from .config import settings

# open=False: the app can start (and pass liveness) even if Postgres is down.
# The pool is opened in the FastAPI lifespan and reconnects in the background.
pool = ConnectionPool(settings.database_url, min_size=1, max_size=5, open=False)
