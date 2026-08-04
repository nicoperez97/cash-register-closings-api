ALTER TABLE users
  ADD COLUMN favoriteShopId CHAR(36) NULL
  AFTER globalRole;
