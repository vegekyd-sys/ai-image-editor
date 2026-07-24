-- Complete four-locale copy for the Skill set restored after App Store review.
-- Existing values win so later Admin edits are not overwritten.
WITH localized_skill_copy (id, labels, prompts) AS (
  VALUES
  (
    '00f126ac-7451-4ee6-8025-e67dcc7b0169'::uuid,
    '{"en":"World Cup MVP","zh":"绿茵巨星","zh-Hant":"綠茵巨星","ja":"ワールドカップMVP"}'::jsonb,
    '{"en":"Upload your photo and become the star of the World Cup pitch.","zh":"上传你的照片，成为世界杯赛场上的焦点球星。","zh-Hant":"上傳你的照片，成為世界盃賽場上的焦點球星。","ja":"写真をアップロードして、ワールドカップのピッチを沸かせるスター選手になりましょう。"}'::jsonb
  ),
  (
    '34bd54e7-8b2e-49f6-a746-d8658ab63fd5'::uuid,
    '{"en":"Rainy Kiss","zh":"雨中热吻","zh-Hant":"雨中熱吻","ja":"雨の中のキス"}'::jsonb,
    '{"en":"Turn my photo into a passionate rainy kiss scene","zh":"把我的照片变成一个浪漫的雨中热吻场景","zh-Hant":"將我的照片變成一個浪漫的雨中熱吻場景","ja":"私の写真を情熱的な雨の中のキスシーンにしてください"}'::jsonb
  ),
  (
    'e573113a-6afc-4054-b8db-c0d9f1c4efbd'::uuid,
    '{"en":"Football Captain","zh":"足球队长","zh-Hant":"足球隊長","ja":"サッカーキャプテン"}'::jsonb,
    '{"en":"One photo is all it takes to become the leader on the pitch and rule the game.","zh":"只需一张照片，化身球场领袖，掌控整场比赛。","zh-Hant":"只需一張照片，化身球場領袖，掌控整場比賽。","ja":"写真1枚でピッチのリーダーとなり、試合を支配する姿に変身しましょう。"}'::jsonb
  ),
  (
    '4a569b11-4a6d-4191-9a00-4375bf90c501'::uuid,
    '{"en":"World Cup Live Candid","zh":"世界杯转播","zh-Hant":"世界盃轉播","ja":"ワールドカップ中継"}'::jsonb,
    '{"en":"Upload your photo to create a candid World Cup live-action video.","zh":"上传你的照片，生成一段世界杯直播抓拍风格的视频。","zh-Hant":"上傳你的照片，生成一段世界盃直播抓拍風格的影片。","ja":"写真をアップロードして、ワールドカップ中継の自然な一幕のような動画を作りましょう。"}'::jsonb
  ),
  (
    '0eb165bf-c407-432c-8e55-2b9081bc1022'::uuid,
    '{"en":"Bicycle Kick Hero","zh":"倒挂金钩","zh-Hant":"倒掛金鉤","ja":"オーバーヘッドキック"}'::jsonb,
    '{"en":"Turn me into a football star with a dramatic bicycle kick goal","zh":"让我化身足球巨星，完成一记震撼的倒挂金钩破门。","zh-Hant":"讓我化身足球巨星，完成一記震撼的倒掛金鉤破門。","ja":"豪快なオーバーヘッドキックでゴールを決めるサッカースターの姿にしてください。"}'::jsonb
  ),
  (
    '8c29c7fd-efed-44ce-8cc8-27e222deb100'::uuid,
    '{"en":"Star Card Dressup","zh":"球星卡变装","zh-Hant":"球星卡變裝","ja":"スターカード変身"}'::jsonb,
    '{"en":"Transform into a World Cup star card — strike a pose in your national team kit with holographic flair","zh":"变身世界杯球星卡人物，身穿国家队球衣摆出姿势，呈现炫彩全息质感。","zh-Hant":"變身世界盃球星卡人物，身穿國家隊球衣擺出姿勢，呈現炫彩全息質感。","ja":"代表チームのユニフォームでポーズを決め、ホログラムの輝きをまとったワールドカップのスターカード風に変身してください。"}'::jsonb
  ),
  (
    '496d3778-94fa-461f-86e0-7b53ab97ab69'::uuid,
    '{"en":"Curling Free Kick","zh":"圆月弯刀任意球","zh-Hant":"圓月彎刀任意球","ja":"カーブフリーキック"}'::jsonb,
    '{"en":"Turn me into a football star scoring a stunning curling free kick goal","zh":"让我化身足球巨星，踢出一记精彩的弧线任意球破门。","zh-Hant":"讓我化身足球巨星，踢出一記精彩的弧線任意球破門。","ja":"鮮やかなカーブを描くフリーキックでゴールを決めるサッカースターの姿にしてください。"}'::jsonb
  ),
  (
    'a5dbd66e-4a87-4495-b225-c679947df465'::uuid,
    '{"en":"Keeper Moment","zh":"门神时刻","zh-Hant":"門神時刻","ja":"守護神の瞬間"}'::jsonb,
    '{"en":"Turn your photo into a cinematic goalkeeper save highlight","zh":"把你的照片变成电影感十足的门将精彩扑救集锦。","zh-Hant":"把你的照片變成電影感十足的門將精彩撲救精華。","ja":"写真を映画のようなゴールキーパーのスーパーセーブ映像に変えてください。"}'::jsonb
  )
)
UPDATE public.home_skills AS skill
SET labels = localized.labels || COALESCE(skill.labels, '{}'::jsonb),
    prompts = localized.prompts || COALESCE(skill.prompts, '{}'::jsonb),
    updated_at = now()
FROM localized_skill_copy AS localized
WHERE skill.id = localized.id;
