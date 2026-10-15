export async function deviceSetupPending(db: D1Database, user: string) {
  return Boolean(
    await db
      .prepare('SELECT 1 FROM device_setup WHERE user_id=?')
      .bind(user)
      .first(),
  );
}

export async function completeDeviceSetup(db: D1Database, user: string) {
  await db.prepare('DELETE FROM device_setup WHERE user_id=?').bind(user).run();
}
