-- Лица и обложки.
--
-- Столбец `avatar_url` лежал в схеме с самого начала и не был записан
-- ни разу: загрузить фотографию было нечем. Люди в списке различались
-- двумя буквами инициалов, а группы — вообще ничем, кроме названия,
-- которое в узкой колонке обрезается на третьем слове.
--
-- Меняем ссылку на файл. Текстовый адрес — это обещание, за которым
-- никто не следит: файл удалят, строка останется, и в списке
-- сотрудников повиснут битые картинки. Ссылка на `files` снимается
-- вместе с файлом сама.

ALTER TABLE workspace_profiles DROP COLUMN avatar_url;

ALTER TABLE workspace_profiles ADD COLUMN avatar_file_id uuid;
ALTER TABLE workspace_profiles
  ADD CONSTRAINT workspace_profiles_avatar_fkey
  FOREIGN KEY (workspace_id, avatar_file_id) REFERENCES files(workspace_id, id) ON DELETE SET NULL;

-- У группы и канала фотография своя; у личной переписки её нет и быть
-- не может — там показывается лицо собеседника.
ALTER TABLE conversations ADD COLUMN avatar_file_id uuid;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_avatar_fkey
  FOREIGN KEY (workspace_id, avatar_file_id) REFERENCES files(workspace_id, id) ON DELETE SET NULL;
