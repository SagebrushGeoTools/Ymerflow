from pydantic_settings import BaseSettings


class BillingSettings(BaseSettings):
    process_cost: float = 0.10
    initial_user_balance: float = 100.0

    class Config:
        env_file = "config.env"
        env_prefix = "BILLING_"
        extra = "ignore"


billing_settings = BillingSettings()
