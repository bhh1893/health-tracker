from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HT_")

    database_url: str = "postgresql://health:health@localhost:5432/health"


settings = Settings()
