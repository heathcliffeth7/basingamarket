use sqlx::{PgPool, Postgres, Transaction};

use crate::{DbError, MIGRATOR};

#[derive(Debug, Clone)]
pub struct PgStore {
    pub pool: PgPool,
}

impl PgStore {
    pub async fn connect(database_url: &str) -> Result<Self, DbError> {
        Ok(Self {
            pool: PgPool::connect(database_url).await?,
        })
    }

    pub async fn migrate(&self) -> Result<(), sqlx::migrate::MigrateError> {
        MIGRATOR.run(&self.pool).await
    }

    pub async fn begin(&self) -> Result<Transaction<'_, Postgres>, DbError> {
        Ok(self.pool.begin().await?)
    }
}
