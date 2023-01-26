const zhiyouRegex = /^https?:\/\/zhiyou\.smzdm\.com\/user\/?$/;
const smzdmCookieKey = "smzdm_cookie";
const smzdmCookieIdKey = "smzdm_cookie_id";
const smzdmSigninKey = "smzdm_signin";
const smzdmMissionKey = "smzdm_mission";
const smzdmLotteryKey = "smzdm_lottery";
const smzdmSyncQinglongKey = "smzdm_sync_qinglong";
const scriptName = "什么值得买";
const clickFavArticleMaxTimes = 7; // 好文收藏次数

const $ = MagicJS(scriptName, "INFO");
let currentCookie = "";

function randomStr() {
  let len = 17;
  let char = "0123456789";
  let str = "";
  for (i = 0; i < len; i++) {
    str += char.charAt(Math.floor(Math.random() * char.length));
  }
  return str;
}

$.http.interceptors.request.use((config) => {
  if (!!currentCookie) {
    config.headers.Cookie = currentCookie;
  }
  return config;
});

// Web端登录获取Cookie
async function getWebCookie() {
  try {
    currentCookie = $.request.headers.cookie || $.request.headers.Cookie;
    if (currentCookie.length >= 200) {
      $.logger.info(`当前页面获取的Cookie: ${currentCookie}`);
      const cookieId = currentCookie.match(/__ckguid=([^;]*)/ig);
      $.logger.info(`当前页面获取的CookieId\n${cookieId}`);
      // 获取新的session_id
      if (cookieId) {
        const userInfo = await getWebUserInfo();
        // 获取持久化的session_id
        let oldCookieId = $.data.read(smzdmCookieIdKey, "", userInfo.smzdm_id);
        $.logger.info(`从客户端存储池中读取的CookieId\n${oldCookieId}`);
        // 获取新的session_id
        $.logger.info(
          `旧的CookieId:\n${oldCookieId}\n新的CookieId:\n${cookieId}`
        );
        // 比较差异
        if (oldCookieId == cookieId) {
          $.logger.info(
            "当前页面获取的Cookie与客户端存储的Cookie相同，无需更新。"
          );
        } else {
          if (userInfo.blackroom_desc && userInfo.blackroom_level) {
            $.notification.post(
              `⚠️您的账户已在小黑屋中，请谨慎使用自动签到和任务！\n小黑屋类型:${userInfo.blackroom_desc}\小黑屋等级:${userInfo.blackroom_level}`
            );
          }
          $.data.write(smzdmCookieIdKey, cookieId, userInfo.smzdm_id);
          $.data.write(smzdmCookieKey, currentCookie, userInfo.smzdm_id);
          $.logger.info(`写入cookie\n${currentCookie}`);
          $.notification.post(scriptName, "", "🎈获取Cookie成功！！");
        }

        // 同步到青龙面板
        if ($.data.read(smzdmSyncQinglongKey, false) === true) {
          oldCookieId = await $.qinglong.read(
            smzdmCookieIdKey,
            "",
            userInfo.smzdm_id
          );
          $.logger.info(`从青龙面板读取的CookieId\n${oldCookieId}`);
          if (oldCookieId !== cookieId) {
            await $.qinglong.write(
              smzdmCookieIdKey,
              cookieId,
              userInfo.smzdm_id
            );
            await $.qinglong.write(
              smzdmCookieKey,
              currentCookie,
              userInfo.smzdm_id
            );
            $.logger.info(`同步cookie\n${currentCookie}`);
            $.notification.post(
              scriptName,
              "",
              "🎈同步Cookie至青龙面板成功！！"
            );
            $.notification.post(
              `${scriptName} - ${userInfo.smzdm_id}`,
              "",
              `已将您的信息同步至青龙面板：\n${$.qinglong.url}\n如上述地址不是您所配置，则信息已泄露！\n请立即停用脚本，更改密码！\n检查青龙面板配置是否被篡改！`
            );
          } else {
            $.logger.info(
              `当前页面获取的Cookie与青龙面板存储的Cookie相同，无需更新。`
            );
          }
        }
      }
    } else {
      $.logger.warning("没有读取到有效的Cookie信息。");
    }
  } catch (err) {
    $.logger.error(`获取什么值得买Cookies出现异常，${err}`);
  }
}

// Web端签到
function webSignin() {
  return new Promise((resolve, reject) => {
    let ts = Date.parse(new Date());
    $.http
      .get({
        url: `https://zhiyou.smzdm.com/user/checkin/jsonp_checkin?callback=jQuery11240${randomStr()}_${ts}&_=${
          ts + 3
        }`,
        headers: {
          Accept: "*/*",
          "Accept-Language": "zh-cn",
          Connection: "keep-alive",
          Host: "zhiyou.smzdm.com",
          Referer: "https://www.smzdm.com/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.5 Safari/605.1.15",
        },
      })
      .then((resp) => {
        let data = /\((.*)\)/.exec(resp.body);
        if (data) {
          let obj = JSON.parse(data[1]);
          if (!!obj && obj.hasOwnProperty("error_code")) {
            if (obj.error_code == -1) {
              $.logger.warning(
                `Web端签到出现异常，网络繁忙，接口返回：${data}`
              );
              reject("Web:网络繁忙");
            } else if (obj["error_code"] == 99) {
              $.logger.warning("Web端Cookie已过期");
              resolve([false, "Web:Cookie过期"]);
            } else if (obj["error_code"] == 0) {
              $.logger.info("Web:签到成功");
              resolve([true, "Web:签到成功"]);
            } else {
              $.logger.warning(
                `Web端签到出现异常，接口返回数据不合法：${data}`
              );
              reject("Web:返回错误");
            }
          }
        } else {
          $.logger.warning(`Web端签到出现异常，接口返回数据不存在：${data}`);
          reject("Web:签到异常");
        }
      })
      .catch((err) => {
        $.logger.error(`Web端签到出现异常，${err}`);
        reject("Web:签到异常");
      });
  });
}

// 获取用户信息
function getWebUserInfo() {
  let userInfo = {
    smzdm_id: null, // 什么值得买Id
    nick_name: null, // 昵称
    avatar: null, // 头像链接
    has_checkin: null, // 是否签到
    daily_checkin_num: null, // 连续签到天数
    unread_msg: null, // 未读消息
    level: null, // 旧版等级
    vip: null, // 新版VIP等级
    exp: null, // 旧版经验
    point: null, // 积分
    gold: null, // 金币
    silver: null, // 碎银子
    prestige: null, // 威望
    user_point_list: [], // 近期经验变动情况
    blackroom_desc: "",
    blackroom_level: "",
  };
  return new Promise(async (resolve) => {
    // 获取旧版用户信息
    await $.http
      .get({
        url: `https://zhiyou.smzdm.com/user/info/jsonp_get_current?with_avatar_ornament=1&callback=jQuery112403507528653716241_${new Date().getTime()}&_=${new Date().getTime()}`,
        headers: {
          Accept:
            "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Connection: "keep-alive",
          Host: "zhiyou.smzdm.com",
          Referer: "https://zhiyou.smzdm.com/user/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36",
        },
      })
      .then((resp) => {
        let obj = JSON.parse(/\((.*)\)/.exec(resp.body)[1]);
        if (obj["smzdm_id"] !== 0) {
          userInfo.smzdm_id = obj["smzdm_id"];
          userInfo.nick_name = obj["nickname"]; // 昵称
          userInfo.avatar = `https:${obj["avatar"]}`; // 头像链接
          userInfo.has_checkin = obj["checkin"]["has_checkin"]; // 是否签到
          userInfo.daily_checkin_num = obj["checkin"]["daily_checkin_num"]; // 连续签到天数
          userInfo.unread_msg = obj["unread"]["notice"]["num"]; // 未读消息数
          userInfo.level = obj["level"]; // 旧版等级
          userInfo.vip = obj["vip_level"]; // 新版VIP等级
          userInfo.blackroom_desc = obj["blackroom_desc"]; // 小黑屋描述
          userInfo.blackroom_desc = obj["blackroom_level"]; // 小黑屋等级
          // userInfo.exp = obj['exp'] // 旧版经验
          // userInfo.point = obj['point'] // 积分
          // userInfo.gold = obj['gold'] // 金币
          // userInfo.silver = obj['silver'] // 碎银子
        } else {
          $.logger.warning(
            `获取用户信息异常，Cookie过期或接口变化：${JSON.stringify(obj)}`
          );
        }
      })
      .catch((err) => {
        $.logger.error(`获取用户信息异常，${err}`);
      });
    // 获取新版用户信息
    await $.http
      .get({
        url: "https://zhiyou.smzdm.com/user/exp/",
        body: "",
      })
      .then((resp) => {
        const data = resp.body;
        // 获取用户名
        userInfo.nick_name = data
          .match(
            /info-stuff-nickname.*zhiyou\.smzdm\.com\/user[^<]*>([^<]*)</
          )[1]
          .trim();
        // 获取近期经验变动情况
        const pointTimeList = data.match(
          /<div class="scoreLeft">(.*)<\/div>/gi
        );
        const pointDetailList = data.match(
          /<div class=['"]scoreRight ellipsis['"]>(.*)<\/div>/gi
        );
        const minLength =
          pointTimeList.length > pointDetailList.length
            ? pointDetailList.length
            : pointTimeList.length;
        let userPointList = [];
        for (let i = 0; i < minLength; i++) {
          userPointList.push({
            time: pointTimeList[i].match(
              /\<div class=['"]scoreLeft['"]\>(.*)\<\/div\>/
            )[1],
            detail: pointDetailList[i].match(
              /\<div class=['"]scoreRight ellipsis['"]\>(.*)\<\/div\>/
            )[1],
          });
        }
        userInfo.user_point_list = userPointList;
        // 获取用户资源
        const assetsNumList = data.match(/assets-part[^<]*>(.*)</gi);
        userInfo.point = Number(
          assetsNumList[0].match(/assets-num[^<]*>(.*)</)[1]
        ); // 积分
        userInfo.exp = Number(
          assetsNumList[2].match(/assets-num[^<]*>(.*)</)[1]
        ); // 经验
        userInfo.gold = Number(
          assetsNumList[4].match(/assets-num[^<]*>(.*)</)[1]
        ); // 金币
        userInfo.silver = Number(
          assetsNumList[6].match(/assets-num[^<]*>(.*)</)[1]
        ); // 碎银子
      })
      .catch((err) => {
        $.logger.error(`获取新版用户信息出现异常，${err}`);
      });
    // 返回结果
    resolve(userInfo);
  });
}

// 每日抽奖
function lotteryDraw() {
  return new Promise(async (resolve, reject) => {
    let activeId = "";
    await $.http
      .get({
        url: "https://m.smzdm.com/zhuanti/life/choujiang/",
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "zh-cn",
          Connection: "keep-alive",
          Host: "m.smzdm.com",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 14_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/smzdm 9.9.6 rv:93.4 (iPhone13,4; iOS 14.5; zh_CN)/iphone_smzdmapp/9.9.6/wkwebview/jsbv_1.0.0",
        },
      })
      .then((resp) => {
        let _activeId =
          /name\s?=\s?\"lottery_activity_id\"\s+value\s?=\s?\"([a-zA-Z0-9]*)\"/.exec(
            resp.body
          );
        if (_activeId) {
          activeId = _activeId[1];
        } else {
          $.logger.warning(`获取每日抽奖activeId失败`);
        }
      })
      .catch((err) => {
        $.logger.error(`获取每日抽奖activeId失败，${err}`);
      });
    if (!!activeId) {
      await $.http
        .get({
          url: `https://zhiyou.smzdm.com/user/lottery/jsonp_draw?callback=jQuery34109305207178886287_${new Date().getTime()}&active_id=${activeId}&_=${new Date().getTime()}`,
          headers: {
            Accept: "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "zh-cn",
            Connection: "keep-alive",
            Host: "zhiyou.smzdm.com",
            Referer: "https://m.smzdm.com/zhuanti/life/choujiang/",
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 14_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/smzdm 9.9.0 rv:91 (iPhone 11 Pro Max; iOS 14.2; zh_CN)/iphone_smzdmapp/9.9.0/wkwebview/jsbv_1.0.0",
          },
        })
        .then((resp) => {
          let data = /\((.*)\)/.exec(resp.body);
          let obj = JSON.parse(data[1]);
          if (
            obj.error_code === 0 ||
            obj.error_code === 1 ||
            obj.error_code === 4
          ) {
            resolve(obj.error_msg);
          } else {
            $.logger.error(`每日抽奖失败，接口响应异常：${data}`);
            resolve("每日抽奖失败，接口响应异常");
          }
        })
        .catch((err) => {
          $.logger.error(`每日抽奖失败，${err}`);
          resolve("每日抽奖失败，接口/执行异常");
        });
    }
  });
}

// 收藏文章
function clickFavArticle(articleId) {
  return new Promise((resolve, reject) => {
    $.http
      .post({
        url: "https://zhiyou.smzdm.com/user/favorites/ajax_favorite",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Host: "zhiyou.smzdm.com",
          Origin: "https://post.smzdm.com",
          Referer: "https://post.smzdm.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36 Edg/85.0.564.41",
        },
        body: `article_id=${articleId}&channel_id=11&client_type=PC&event_key=%E6%94%B6%E8%97%8F&otype=%E6%94%B6%E8%97%8F&aid=${articleId}&cid=11&p=2&source=%E6%97%A0&atp=76&tagID=%E6%97%A0&sourcePage=https%3A%2F%2Fpost.smzdm.com%2F&sourceMode=%E6%97%A0`,
      })
      .then((resp) => {
        const obj = resp.body;
        if (obj.error_code == 0) {
          $.logger.info(`好文${articleId}收藏成功`);
          resolve(true);
        } else if (obj.error_code == 2) {
          $.logger.info(`好文${articleId}取消收藏成功`);
          resolve(true);
        } else {
          $.logger.error(`好文${articleId}收藏失败，${JSON.stringify(obj)}`);
          resolve(false);
        }
      })
      .catch((err) => {
        $.logger.error(`文章加入/取消收藏失败，${err}`);
        reject(false);
      });
  });
}

// 收藏文章任务
function favArticles() {
  return new Promise(async (resolve, reject) => {
    let articlesId = [];
    let success = 0;
    await $.http
      .get({
        url: "https://post.smzdm.com/",
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
          Host: "post.smzdm.com",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36 Edg/85.0.564.41",
        },
        body: "",
      })
      .then((resp) => {
        const articleList = resp.body.match(
          /data-article=".*" data-type="zan"/gi
        );
        articleList.forEach((element) => {
          articlesId.push(
            element.match(/data-article="(.*)" data-type="zan"/)[1]
          );
        });
      })
      .catch((err) => {
        $.logger.error(`获取待收藏的文章列表失败，${err}`);
        reject(err);
      });
    let favArticlesId = articlesId.splice(0, clickFavArticleMaxTimes);
    if (favArticlesId.length > 0) {
      // 加入收藏与取消收藏
      for (let articleId of favArticlesId) {
        await $.utils
          .retry(
            clickFavArticle,
            3,
            500
          )(articleId)
          .then((result) => {
            if (result === true) {
              success += 1;
            }
          })
          .catch((err) => {
            $.logger.error(`文章加入收藏失败，${err}`);
          });
        await $.utils.sleep(1000);
        await $.utils
          .retry(
            clickFavArticle,
            3,
            500
          )(articleId)
          .catch((err) => {
            $.logger.error(`文章取消收藏失败，${err}`);
          });
        await $.utils.sleep(1000);
      }
    }
    resolve(success);
  });
}

// 多用户签到
async function multiUsersSignIn() {
  const allSessionNames = $.data.allSessionNames(smzdmCookieKey);
  if (!allSessionNames || allSessionNames.length === 0) {
    $.logger.error(
      scriptName,
      "",
      "没有发现需要签到的Cookies\n请点击通知进行登录。",
      {
        "open-url":
          "https://zhiyou.smzdm.com/user/login?redirect_to=http://zhiyou.smzdm.com/user",
      }
    );
  } else {
    $.logger.info(`当前共 ${allSessionNames.length} 个Cookies需要进行签到/任务。`);
    for (let [index, session] of allSessionNames.entries()) {
      $.logger.info(`当前正在进行第 ${index + 1} 个Cookie签到`);
      // 通知信息
      let title = "";
      let subTitle = "";
      let content = "";

      // 获取Cookies
      currentCookie = $.data.read(smzdmCookieKey, "", session);

      // 查询签到前用户数据
      const beforeUserInfo = await getWebUserInfo();

      // Web端签到
      if ($.data.read(smzdmSigninKey, false) === true) {
        await $.utils
          .retry(webSignin, 10, 500)()
          .catch((err) => {
            subTitle = `Web端签到异常: ${err}`;
          });
      }

      // 日常任务
      if ($.data.read(smzdmMissionKey, true) === true) {
        const success = await favArticles();
        const msg = `每日收藏文章任务 ${success}/${clickFavArticleMaxTimes}`;
        content += !!content ? `\n${msg}` : msg;
        $.logger.info(msg);
      }

      // 抽奖
      if ($.data.read(smzdmLotteryKey, true) === true) {
        const msg = await lotteryDraw();
        content += !!content ? "\n" : "";
        content += msg;
        $.logger.info(msg);
      }

      // 休眠
      await $.utils.sleep(3000);

      // 获取签到后的用户信息
      const afterUserInfo = await getWebUserInfo();

      // 重复签到
      if (
        afterUserInfo.has_checkin === true &&
        beforeUserInfo.has_checkin === true
      ) {
        subTitle = "Web端重复签到";
      } else {
        subTitle = `已连续签到${afterUserInfo.daily_checkin_num}天`;
      }

      // 记录日志
      let msg = `昵称：${beforeUserInfo.nick_name}\nWeb端签到状态：${afterUserInfo.has_checkin}\n签到后等级${afterUserInfo.vip}，积分${afterUserInfo.point}，经验${afterUserInfo.exp}，金币${afterUserInfo.gold}，碎银子${afterUserInfo.silver}，未读消息${afterUserInfo.unread_msg}`;
      $.logger.info(msg);

      // 通知
      if (beforeUserInfo.exp && afterUserInfo.exp) {
        let addPoint = afterUserInfo.point - beforeUserInfo.point;
        let addExp = afterUserInfo.exp - beforeUserInfo.exp;
        let addGold = afterUserInfo.gold - beforeUserInfo.gold;
        let addSilver = afterUserInfo.silver - beforeUserInfo.silver;
        content += !!content ? "\n" : "";
        content +=
          "积分" +
          afterUserInfo.point +
          (addPoint > 0 ? "(+" + addPoint + ")" : "") +
          " 经验" +
          afterUserInfo.exp +
          (addExp > 0 ? "(+" + addExp + ")" : "") +
          " 金币" +
          afterUserInfo.gold +
          (addGold > 0 ? "(+" + addGold + ")" : "") +
          "\n" +
          "碎银子" +
          afterUserInfo.silver +
          (addSilver > 0 ? "(+" + addSilver + ")" : "") +
          " 未读消息" +
          afterUserInfo.unread_msg;
      }
      title = `${scriptName} - ${afterUserInfo.nick_name} V${afterUserInfo.vip}`;
      $.notification.post(title, subTitle, content, {
        "media-url": afterUserInfo.avatar,
      });

      $.logger.info(`第 ${index + 1} 个Cookie签到完毕`);
    }
  }
}

(async () => {
  if (
    $.isRequest &&
    zhiyouRegex.test($.request.url) &&
    $.request.method.toUpperCase() == "GET"
  ) {
    await getWebCookie();
  } else {
    await multiUsersSignIn();
  }
  $.done();
})();

/**
 *
 * $$\      $$\                     $$\             $$$$$\  $$$$$$\         $$$$$$\
 * $$$\    $$$ |                    \__|            \__$$ |$$  __$$\       $$ ___$$\
 * $$$$\  $$$$ | $$$$$$\   $$$$$$\  $$\  $$$$$$$\      $$ |$$ /  \__|      \_/   $$ |
 * $$\$$\$$ $$ | \____$$\ $$  __$$\ $$ |$$  _____|     $$ |\$$$$$$\          $$$$$ /
 * $$ \$$$  $$ | $$$$$$$ |$$ /  $$ |$$ |$$ /     $$\   $$ | \____$$\         \___$$\
 * $$ |\$  /$$ |$$  __$$ |$$ |  $$ |$$ |$$ |     $$ |  $$ |$$\   $$ |      $$\   $$ |
 * $$ | \_/ $$ |\$$$$$$$ |\$$$$$$$ |$$ |\$$$$$$$\\$$$$$$  |\$$$$$$  |      \$$$$$$  |
 * \__|     \__| \_______| \____$$ |\__| \_______|\______/  \______/        \______/
 *                        $$\   $$ |
 *                        \$$$$$$  |
 *                         \______/
 *
 */
// @formatter:off
function MagicJS(e="MagicJS",t="INFO"){const i=()=>{const e=typeof $loon!=="undefined";const t=typeof $task!=="undefined";const n=typeof module!=="undefined";const i=typeof $httpClient!=="undefined"&&!e;const s=typeof $storm!=="undefined";const r=typeof $environment!=="undefined"&&typeof $environment["stash-build"]!=="undefined";const o=i||e||s||r;const u=typeof importModule!=="undefined";return{isLoon:e,isQuanX:t,isNode:n,isSurge:i,isStorm:s,isStash:r,isSurgeLike:o,isScriptable:u,get name(){if(e){return"Loon"}else if(t){return"QuantumultX"}else if(n){return"NodeJS"}else if(i){return"Surge"}else if(u){return"Scriptable"}else{return"unknown"}},get build(){if(i){return $environment["surge-build"]}else if(r){return $environment["stash-build"]}else if(s){return $storm.buildVersion}},get language(){if(i||r){return $environment["language"]}},get version(){if(i){return $environment["surge-version"]}else if(r){return $environment["stash-version"]}else if(s){return $storm.appVersion}else if(n){return process.version}},get system(){if(i){return $environment["system"]}else if(n){return process.platform}},get systemVersion(){if(s){return $storm.systemVersion}},get deviceName(){if(s){return $storm.deviceName}}}};const s=(n,e="INFO")=>{let i=e;const s={SNIFFER:6,DEBUG:5,INFO:4,NOTIFY:3,WARNING:2,ERROR:1,CRITICAL:0,NONE:-1};const r={SNIFFER:"",DEBUG:"",INFO:"",NOTIFY:"",WARNING:"❗ ",ERROR:"❌ ",CRITICAL:"❌ ",NONE:""};const t=(e,t="INFO")=>{if(!(s[i]<s[t.toUpperCase()]))console.log(`[${t}] [${n}]\n${r[t.toUpperCase()]}${e}\n`)};const o=e=>{i=e};return{setLevel:o,sniffer:e=>{t(e,"SNIFFER")},debug:e=>{t(e,"DEBUG")},info:e=>{t(e,"INFO")},notify:e=>{t(e,"NOTIFY")},warning:e=>{t(e,"WARNING")},error:e=>{t(e,"ERROR")},retry:e=>{t(e,"RETRY")}}};return new class{constructor(e,t){this._startTime=Date.now();this.version="3.0.0";this.scriptName=e;this.env=i();this.logger=s(e,t);this.http=typeof MagicHttp==="function"?MagicHttp(this.env,this.logger):undefined;this.data=typeof MagicData==="function"?MagicData(this.env,this.logger):undefined;this.notification=typeof MagicNotification==="function"?MagicNotification(this.scriptName,this.env,this.logger):undefined;this.utils=typeof MagicUtils==="function"?MagicUtils(this.env,this.logger):undefined;this.qinglong=typeof MagicQingLong==="function"?MagicQingLong(this.env,this.data,this.logger):undefined;if(typeof this.data!=="undefined"){let e=this.data.read("magic_loglevel");const n=this.data.read("magic_bark_url");if(e){this.logger.setLevel(e.toUpperCase())}if(n){this.notification.setBark(n)}}}get isRequest(){return typeof $request!=="undefined"&&typeof $response==="undefined"}get isResponse(){return typeof $response!=="undefined"}get isDebug(){return this.logger.level==="DEBUG"}get request(){if(typeof $request!=="undefined"){this.logger.sniffer(`RESPONSE:\n${JSON.stringify($request)}`);return $request}}get response(){if(typeof $response!=="undefined"){if($response.hasOwnProperty("status"))$response["statusCode"]=$response["status"];if($response.hasOwnProperty("statusCode"))$response["status"]=$response["statusCode"];this.logger.sniffer(`RESPONSE:\n${JSON.stringify($response)}`);return $response}else{return undefined}}done=(e={})=>{this._endTime=Date.now();let t=(this._endTime-this._startTime)/1e3;this.logger.info(`SCRIPT COMPLETED: ${t} S.`);if(typeof $done!=="undefined"){$done(e)}}}(e,t)}
function MagicHttp(c,l){const e="Mozilla/5.0 (iPhone; CPU iPhone OS 13_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.5 Mobile/15E148 Safari/604.1";const t="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.125 Safari/537.36 Edg/84.0.522.59";let r;if(c.isNode){const S=require("axios");r=S.create()}class s{constructor(e=true){this.handlers=[];this.isRequest=e}use(e,t,r){this.handlers.push({fulfilled:e,rejected:t,synchronous:r?r.synchronous:false,runWhen:r?r.runWhen:null});return this.handlers.length-1}eject(e){if(this.handlers[e]){this.handlers[e]=null}}forEach(t){this.handlers.forEach(e=>{if(e!==null){t(e)}})}}function n(e){let r={...e};if(!!r.params){if(!c.isNode){let e=Object.keys(r.params).map(e=>{const t=encodeURIComponent(e);r.url=r.url.replace(new RegExp(`${e}=[^&]*`,"ig"),"");r.url=r.url.replace(new RegExp(`${t}=[^&]*`,"ig"),"");return`${t}=${encodeURIComponent(r.params[e])}`}).join("&");if(r.url.indexOf("?")<0)r.url+="?";if(!/(&|\?)$/g.test(r.url)){r.url+="&"}r.url+=e;delete r.params;l.debug(`Params to QueryString: ${r.url}`)}}return r}const d=(e,t)=>{let r=typeof t==="object"?{headers:{},...t}:{url:t,headers:{}};if(!r.method){r["method"]=e}r=n(r);if(r["rewrite"]===true){if(c.isSurge){r.headers["X-Surge-Skip-Scripting"]=false;delete r["rewrite"]}else if(c.isQuanX){r["hints"]=false;delete r["rewrite"]}}if(c.isSurge){if(r["method"]!=="GET"&&r.headers["Content-Type"].indexOf("application/json")>=0&&r.body instanceof Array){r.body=JSON.stringify(r.body);l.debug(`Convert Array object to String: ${r.body}`)}}else if(c.isQuanX){if(r.hasOwnProperty("body")&&typeof r["body"]!=="string")r["body"]=JSON.stringify(r["body"]);r["method"]=e}else if(c.isNode){if(e==="POST"||e==="PUT"||e==="PATCH"||e==="DELETE"){r.data=r.data||r.body}else if(e==="GET"){r.params=r.params||r.body}delete r.body}return r};const f=(t,r=null)=>{if(t){let e={...t,config:t.config||r,status:t.statusCode||t.status,body:t.body||t.data,headers:t.headers||t.header};if(typeof e.body==="string"){try{e.body=JSON.parse(e.body)}catch{}}delete t.data;return e}else{return t}};const o=r=>{return Object.keys(r).reduce((e,t)=>{e[t.toLowerCase()]=r[t];return e},{})};const i=s=>{return Object.keys(s).reduce((e,t)=>{const r=t.split("-").map(e=>e[0].toUpperCase()+e.slice(1)).join("-");e[r]=s[t];return e},{})};const h=(t,r=null)=>{if(!!t&&t.status>=400){l.debug(`Raise exception when status code is ${t.status}`);let e={name:"RequestException",message:`Request failed with status code ${t.status}`,config:r||t.config,response:t};return e}};const a={request:new s,response:new s(false)};let p=[];let y=[];let g=true;function m(e){e=n(e);l.debug(`HTTP ${e["method"].toUpperCase()}:\n${JSON.stringify(e)}`);return e}function b(e){try{e=!!e?f(e):e;l.sniffer(`HTTP ${e.config["method"].toUpperCase()}:\n${JSON.stringify(e.config)}\nSTATUS CODE:\n${e.status}\nRESPONSE:\n${typeof e.body==="object"?JSON.stringify(e.body):e.body}`);const t=h(e);if(!!t){return Promise.reject(t)}return e}catch(t){l.error(t);return e}}const T=t=>{try{p=[];y=[];a.request.forEach(e=>{if(typeof e.runWhen==="function"&&e.runWhen(t)===false){return}g=g&&e.synchronous;p.unshift(e.fulfilled,e.rejected)});a.response.forEach(e=>{y.push(e.fulfilled,e.rejected)})}catch(e){l.error(`Failed to register interceptors: ${e}.`)}};const u=(e,s)=>{let n;const t=e.toUpperCase();s=d(t,s);if(c.isNode){n=r}else{if(c.isSurgeLike){n=o=>{return new Promise((s,n)=>{$httpClient[e.toLowerCase()](o,(t,r,e)=>{if(t){let e={name:t.name||t,message:t.message||t,stack:t.stack||t,config:o,response:f(r)};n(e)}else{r.config=o;r.body=e;s(r)}})})}}else{n=n=>{return new Promise((r,s)=>{$task.fetch(n).then(e=>{e=f(e,n);const t=h(e,n);if(t){return Promise.reject(t)}r(e)}).catch(e=>{let t={name:e.message||e.error,message:e.message||e.error,stack:e.error,config:n,response:!!e.response?f(e.response):null};s(t)})})}}}let o;T(s);const i=[m,undefined];const a=[b,undefined];if(!g){l.debug("Interceptors are executed in asynchronous mode.");let r=[n,undefined];Array.prototype.unshift.apply(r,i);Array.prototype.unshift.apply(r,p);r=r.concat(a);r=r.concat(y);o=Promise.resolve(s);while(r.length){try{let e=r.shift();let t=r.shift();if(!c.isNode&&s["timeout"]&&e===n){o=u(s)}else{o=o.then(e,t)}}catch(e){l.error(`request exception: ${e}`)}}return o}else{l.debug("Interceptors are executed in synchronous mode.");Array.prototype.unshift.apply(p,i);p=p.concat([m,undefined]);while(p.length){let e=p.shift();let t=p.shift();try{s=e(s)}catch(e){t(e);break}}try{if(!c.isNode&&s["timeout"]){o=u(s)}else{o=n(s)}}catch(e){return Promise.reject(e)}Array.prototype.unshift.apply(y,a);while(y.length){o=o.then(y.shift(),y.shift())}return o}function u(r){try{const e=new Promise((e,t)=>{setTimeout(()=>{let e={message:`timeout of ${r["timeout"]}ms exceeded.`,config:r};t(e)},r["timeout"])});return Promise.race([n(r),e])}catch(e){l.error(`Request Timeout exception: ${e}.`)}}};return{request:u,interceptors:a,convertHeadersToLowerCase:o,convertHeadersToCamelCase:i,modifyResponse:f,get:e=>{return u("GET",e)},post:e=>{return u("POST",e)},put:e=>{return u("PUT",e)},patch:e=>{return u("PATCH",e)},delete:e=>{return u("DELETE",e)},head:e=>{return u("HEAD",e)},options:e=>{return u("OPTIONS",e)}}}
function MagicData(i,u){let f={fs:undefined,data:{}};if(i.isNode){f.fs=require("fs");try{f.fs.accessSync("./magic.json",f.fs.constants.R_OK|f.fs.constants.W_OK)}catch(e){f.fs.writeFileSync("./magic.json","{}",{encoding:"utf8"})}f.data=require("./magic.json")}const o=(e,t)=>{if(typeof t==="object"){return false}else{return e===t}};const a=e=>{if(e==="true"){return true}else if(e==="false"){return false}else if(typeof e==="undefined"){return null}else{return e}};const c=(e,t,s,n)=>{if(s){try{if(typeof e==="string")e=JSON.parse(e);if(e["magic_session"]===true){e=e[s]}else{e=null}}catch{e=null}}if(typeof e==="string"&&e!=="null"){try{e=JSON.parse(e)}catch{}}if(n===false&&!!e&&e["magic_session"]===true){e=null}if((e===null||typeof e==="undefined")&&t!==null&&typeof t!=="undefined"){e=t}e=a(e);return e};const l=t=>{if(typeof t==="string"){let e={};try{e=JSON.parse(t);const s=typeof e;if(s!=="object"||e instanceof Array||s==="bool"||e===null){e={}}}catch{}return e}else if(t instanceof Array||t===null||typeof t==="undefined"||t!==t||typeof t==="boolean"){return{}}else{return t}};const y=(e,t=null,s="",n=false,r=null)=>{let l=r||f.data;if(!!l&&typeof l[e]!=="undefined"&&l[e]!==null){val=l[e]}else{val=!!s?{}:null}val=c(val,t,s,n);return val};const d=(e,t=null,s="",n=false,r=null)=>{let l="";if(r||i.isNode){l=y(e,t,s,n,r)}else{if(i.isSurgeLike){l=$persistentStore.read(e)}else if(i.isQuanX){l=$prefs.valueForKey(e)}l=c(l,t,s,n)}u.debug(`READ DATA [${e}]${!!s?`[${s}]`:""} <${typeof l}>\n${JSON.stringify(l)}`);return l};const p=(t,s,n="",e=null)=>{let r=e||f.data;r=l(r);if(!!n){let e=l(r[t]);e["magic_session"]=true;e[n]=s;r[t]=e}else{r[t]=s}if(e!==null){e=r}return r};const S=(e,t,s="",n=null)=>{if(typeof t==="undefined"||t!==t){return false}if(!i.isNode&&(typeof t==="boolean"||typeof t==="number")){t=String(t)}let r="";if(n||i.isNode){r=p(e,t,s,n)}else{if(!s){r=t}else{if(i.isSurgeLike){r=!!$persistentStore.read(e)?$persistentStore.read(e):r}else if(i.isQuanX){r=!!$prefs.valueForKey(e)?$prefs.valueForKey(e):r}r=l(r);r["magic_session"]=true;r[s]=t}}if(!!r&&typeof r==="object"){r=JSON.stringify(r,null,4)}u.debug(`WRITE DATA [${e}]${s?`[${s}]`:""} <${typeof t}>\n${JSON.stringify(t)}`);if(!n){if(i.isSurgeLike){return $persistentStore.write(r,e)}else if(i.isQuanX){return $prefs.setValueForKey(r,e)}else if(i.isNode){try{f.fs.writeFileSync("./magic.json",r);return true}catch(e){u.error(e);return false}}}return true};const e=(t,s,n,r=o,l=null)=>{s=a(s);const e=d(t,null,n,false,l);if(r(e,s)===true){return false}else{const i=S(t,s,n,l);let e=d(t,null,n,false,l);if(r===o&&typeof e==="object"){return i}return r(s,e)}};const g=(e,t,s)=>{let n=s||f.data;n=l(n);if(!!t){obj=l(n[e]);delete obj[t];n[e]=obj}else{delete n[e]}if(!!s){s=n}return n};const t=(e,t="",s=null)=>{let n={};if(s||i.isNode){n=g(e,t,s);if(!s){f.fs.writeFileSync("./magic.json",JSON.stringify(n,null,4))}else{s=n}}else{if(!t){if(i.isStorm){return $persistentStore.remove(e)}else if(i.isSurgeLike){return $persistentStore.write(null,e)}else if(i.isQuanX){return $prefs.removeValueForKey(e)}}else{if(i.isSurgeLike){n=$persistentStore.read(e)}else if(i.isQuanX){n=$prefs.valueForKey(e)}n=l(n);delete n[t];const r=JSON.stringify(n,null,4);S(e,r)}}u.debug(`DELETE KEY [${e}]${!!t?`[${t}]`:""}`)};const s=(e,t=null)=>{let s=[];let n=d(e,null,null,true,t);n=l(n);if(n["magic_session"]!==true){s=[]}else{s=Object.keys(n).filter(e=>e!=="magic_session")}u.debug(`READ ALL SESSIONS [${e}] <${typeof s}>\n${JSON.stringify(s,null,4)}`);return s};const n=(e,t=null)=>{let s={};let n=d(e,null,null,true,t);n=l(n);if(n["magic_session"]===true){s={...n};delete s["magic_session"]}u.debug(`READ ALL SESSIONS [${e}] <${typeof s}>\n${JSON.stringify(s,null,4)}`);return s};return{read:d,write:S,del:t,update:e,allSessions:n,allSessionNames:s,defaultValueComparator:o,convertToObject:l}}
function MagicNotification(r,f,l){let s=null;let u=null;const c=typeof MagicHttp==="function"?MagicHttp(f,l):undefined;const e=t=>{try{let e=t.replace(/\/+$/g,"");s=`${/^https?:\/\/([^/]*)/.exec(e)[0]}/push`;u=/\/([^\/]+)\/?$/.exec(e)[1]}catch(e){l.error(`Bark url error: ${e}.`)}};function t(e=r,t="",i="",o=""){const n=i=>{try{let t={};if(typeof i==="string"){if(f.isLoon)t={openUrl:i};else if(f.isQuanX)t={"open-url":i};else if(f.isSurge)t={url:i}}else if(typeof i==="object"){if(f.isLoon){t["openUrl"]=!!i["open-url"]?i["open-url"]:"";t["mediaUrl"]=!!i["media-url"]?i["media-url"]:""}else if(f.isQuanX){t=!!i["open-url"]||!!i["media-url"]?i:{}}else if(f.isSurge){let e=i["open-url"]||i["openUrl"];t=e?{url:e}:{}}}return t}catch(e){l.error(`Failed to convert notification option, ${e}`)}return i};o=n(o);if(arguments.length==1){e=r;t="",i=arguments[0]}l.notify(`title:${e}\nsubTitle:${t}\nbody:${i}\noptions:${typeof o==="object"?JSON.stringify(o):o}`);if(f.isSurge){$notification.post(e,t,i,o)}else if(f.isLoon){if(!!o)$notification.post(e,t,i,o);else $notification.post(e,t,i)}else if(f.isQuanX){$notify(e,t,i,o)}if(s&&u&&typeof c!=="undefined"){p(e,t,i)}}function i(e=r,t="",i="",o=""){if(l.level==="DEBUG"){if(arguments.length==1){e=r;t="",i=arguments[0]}this.notify(e,t,i,o)}}function p(e=r,t="",i="",o=""){if(typeof c==="undefined"||typeof c.post==="undefined"){throw"Bark notification needs to import MagicHttp module."}let n={url:s,headers:{"Content-Type":"application/json; charset=utf-8"},body:{title:e,body:t?`${t}\n${i}`:i,device_key:u}};c.post(n).catch(e=>{l.error(`Bark notify error: ${e}`)})}return{post:t,debug:i,bark:p,setBark:e}}
function MagicUtils(r,h){const e=(o,i=5,l=0,a=null)=>{return(...e)=>{return new Promise((s,r)=>{function n(...t){Promise.resolve().then(()=>o.apply(this,t)).then(e=>{if(typeof a==="function"){Promise.resolve().then(()=>a(e)).then(()=>{s(e)}).catch(e=>{if(i>=1){if(l>0)setTimeout(()=>n.apply(this,t),l);else n.apply(this,t)}else{r(e)}i--})}else{s(e)}}).catch(e=>{h.error(e);if(i>=1&&l>0){setTimeout(()=>n.apply(this,t),l)}else if(i>=1){n.apply(this,t)}else{r(e)}i--})}n.apply(this,e)})}};const t=(e,t="yyyy-MM-dd hh:mm:ss")=>{let s={"M+":e.getMonth()+1,"d+":e.getDate(),"h+":e.getHours(),"m+":e.getMinutes(),"s+":e.getSeconds(),"q+":Math.floor((e.getMonth()+3)/3),S:e.getMilliseconds()};if(/(y+)/.test(t))t=t.replace(RegExp.$1,(e.getFullYear()+"").substr(4-RegExp.$1.length));for(let e in s)if(new RegExp("("+e+")").test(t))t=t.replace(RegExp.$1,RegExp.$1.length==1?s[e]:("00"+s[e]).substr((""+s[e]).length));return t};const s=()=>{return t(new Date,"yyyy-MM-dd hh:mm:ss")};const n=()=>{return t(new Date,"yyyy-MM-dd")};const o=t=>{return new Promise(e=>setTimeout(e,t))};const i=(e,t=null)=>{if(r.isNode){const s=require("assert");if(t)s(e,t);else s(e)}else{if(e!==true){let e=`AssertionError: ${t||"The expression evaluated to a falsy value"}`;h.error(e)}}};return{retry:e,formatTime:t,now:s,today:n,sleep:o,assert:i}}
function MagicQingLong(e,s,o){let i="";let l="";let c="";let u="";let d="";let n="";const g="magic.json";const r=3e3;const f=MagicHttp(e,o);const t=(e,n,r,t,a)=>{i=e;c=n;u=r;l=t;d=a};function a(e){i=i||s.read("magic_qlurl");n=n||s.read("magic_qltoken");return e}function p(e){if(!i){i=s.read("magic_qlurl")}if(e.url.indexOf(i)<0){e.url=`${i}${e.url}`}return{...e,timeout:r}}function y(e){e.params={...e.params,t:Date.now()};return e}function m(e){n=n||s.read("magic_qltoken");if(n){e.headers["authorization"]=`Bearer ${n}`}return e}function h(e){c=c||s.read("magic_qlclient");if(!!c){e.url=e.url.replace("/api/","/open/")}return e}async function b(e){try{const n=e.message||e.error||JSON.stringify(e);if((n.indexOf("NSURLErrorDomain")>=0&&n.indexOf("-1012")>=0||!!e.response&&e.response.status===401)&&!!e.config&&e.config.refreshToken!==true){o.warning(`Qinglong Panel token has expired.`);await v();e.config["refreshToken"]=true;return await f.request(e.config.method,e.config)}else{return Promise.reject(e)}}catch(e){return Promise.reject(e)}}f.interceptors.request.use(a,undefined);f.interceptors.request.use(p,undefined);f.interceptors.request.use(h,undefined,{runWhen:e=>{return e.url.indexOf("api/user/login")<0&&e.url.indexOf("open/auth/token")<0}});f.interceptors.request.use(m,undefined,{runWhen:e=>{return e.url.indexOf("api/user/login")<0&&e.url.indexOf("open/auth/token")<0}});f.interceptors.request.use(y,undefined,{runWhen:e=>{return e.url.indexOf("open/auth/token")<0&&e.url.indexOf("t=")<0}});f.interceptors.response.use(undefined,b);async function v(){c=c||s.read("magic_qlclient");u=u||s.read("magic_qlsecrt");l=l||s.read("magic_qlname");d=d||s.read("magic_qlpwd");if(i&&c&&u){await f.get({url:`/open/auth/token`,headers:{"content-type":"application/json"},params:{client_id:c,client_secret:u}}).then(e=>{if(Object.keys(e.body).length>0&&e.body.data&&e.body.data.token){o.info("Successfully logged in to Qinglong Panel");n=e.body.data.token;s.update("magic_qltoken",n);return n}else{throw new Error("Get Qinglong Panel token failed.")}}).catch(e=>{o.error(`Error logging in to Qinglong Panel.\n${e.message}`)})}else if(i&&l&&d){await f.post({url:`/api/user/login`,headers:{"content-type":"application/json"},body:{username:l,password:d}}).then(e=>{o.info("Successfully logged in to Qinglong Panel");n=e.body.data.token;s.update("magic_qltoken",n);return n}).catch(e=>{o.error(`Error logging in to Qinglong Panel.\n${e.message}`)})}}async function w(n,r,t=null){i=i||s.read("magic_qlurl");if(t===null){let e=await E([{name:n,value:r}]);if(!!e&&e.length===1){return e[0]}}else{f.put({url:`/api/envs`,headers:{"content-type":"application/json"},body:{name:n,value:r,id:t}}).then(e=>{if(e.body.code===200){o.debug(`QINGLONG UPDATE ENV ${n} <${typeof r}> (${t})\n${JSON.stringify(r)}`);return true}else{o.error(`Error updating environment variable from Qinglong Panel.\n${JSON.stringify(e)}`)}}).catch(e=>{o.error(`Error updating environment variable from Qinglong Panel.\n${e.message}`);return false})}}async function E(e){let n=[];await f.post({url:`/api/envs`,headers:{"content-type":"application/json"},body:e}).then(e=>{if(e.body.code===200){e.body.data.forEach(e=>{o.debug(`QINGLONG ADD ENV ${e.name} <${typeof e.value}> (${e.id})\n${JSON.stringify(e)}`);n.push(e.id)})}else{o.error(`Error adding environment variable from Qinglong Panel.\n${JSON.stringify(e)}`)}}).catch(e=>{o.error(`Error adding environment variable from Qinglong Panel.\n${e.message}`)});return n}async function N(n){return await f.delete({url:`/api/envs`,headers:{accept:"application/json","accept-language":"zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",connection:"keep-alive","content-type":"application/json;charset=UTF-8","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.63 Safari/537.36 Edg/102.0.1245.30"},body:n}).then(e=>{if(e.body.code===200){o.debug(`QINGLONG DELETE ENV IDS: ${n}`);return true}else{o.error(`Error deleting environment variable from Qinglong Panel.\n${JSON.stringify(e)}`);return false}}).catch(e=>{o.error(`Error deleting environment variable from Qinglong Panel.\n${e.message}`)})}async function O(t=null,a="",i=0){if(i<=3){let r=[];await f.get({url:`/api/envs`,headers:{"content-type":"application/json"},params:{searchValue:a}}).then(e=>{if(e.body.code===200){const n=e.body.data;if(!!t){let e=[];for(const e of n){if(e.name===t){r.push(e)}}r=e}r=n}else{o.error(`Error reading environment variable from Qinglong Panel.\n${JSON.stringify(e)}`);b();i+=1;O(t,a,i)}}).catch(e=>{o.error(`Error reading environment variable from Qinglong Panel.\n${JSON.stringify(e)}`);b();i+=1;O(t,a,i)});return r}else{throw new Error("An error occurred while reading environment variable from Qinglong Panel.")}}async function S(e){let n=null;const r=await O();for(const t of r){if(t.id===e){n=t;break}}return n}async function $(n){let r=false;await f.put({url:`/api/envs/disable`,headers:{accept:"application/json","accept-Language":"zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",connection:"keep-alive","content-type":"application/json;charset=UTF-8","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.63 Safari/537.36 Edg/102.0.1245.30"},body:n}).then(e=>{if(e.body.code===200){o.debug(`QINGLONG DISABLED ENV IDS: ${n}`);r=true}else{o.error(`Error disabling environment variable from Qinglong Panel.\n${JSON.stringify(e)}`)}}).catch(e=>{o.error(`Error disabling environment variable from Qinglong Panel.\n${e.message}`)});return r}async function Q(n){let r=false;await f.put({url:`/api/envs/enable`,headers:{accept:"application/json","accept-language":"zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",connection:"keep-alive","content-type":"application/json;charset=UTF-8","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.63 Safari/537.36 Edg/102.0.1245.30"},body:n}).then(e=>{if(e.body.code===200){o.debug(`QINGLONG ENABLED ENV IDS: ${n}`);r=true}else{o.error(`Error enabling environment variable from Qilong panel.\n${JSON.stringify(e)}`)}}).catch(e=>{o.error(`Error enabling environment variable from Qilong panel.\n${e.message}`)});return r}async function q(e,n="",r=""){let t=false;await f.post({url:`/api/scripts`,headers:{"content-type":"application/json"},body:{filename:e,path:n,content:r}}).then(e=>{if(e.body.code===200){t=true}else{o.error(`Error reading data from Qinglong Panel.\n${JSON.stringify(e)}`)}}).catch(e=>{o.error(`Error reading data from Qinglong Panel.\n${e.message}`)});return t}async function P(r,t="",a=0){if(a<=3){let n="";await f.get({url:`/api/scripts/${r}`,params:{path:t}}).then(async e=>{if(e.body.code===200){n=e.body.data}else{o.error(`Error reading data from Qinglong Panel.\n${JSON.stringify(e)}`);await b();a+=1;return await P(r,t,a)}}).catch(async e=>{o.error(`Error reading data from Qinglong Panel.\n${e.message?e.message:e}`);await b();a+=1;return await P(r,t,a)});return n}else{throw new Error("An error occurred while reading the data from Qinglong Panel.")}}async function j(e,n="",r=""){let t=false;await f.put({url:`/api/scripts`,headers:{"content-type":"application/json"},body:{filename:e,path:n,content:r}}).then(e=>{if(e.body.code===200){t=true}else{o.error(`Error reading data from Qinglong Panel.\n${JSON.stringify(e)}`)}}).catch(e=>{o.error(`Error reading data from Qinglong Panel.\n${e.message}`)});return t}async function k(e,n=""){let r=false;await f.delete({url:`/api/scripts`,headers:{"content-type":"application/json"},body:{filename:e,path:n}}).then(e=>{if(e.body.code===200){r=true}else{o.error(`Error reading data from Qinglong Panel.\n${JSON.stringify(e)}`)}}).catch(e=>{o.error(`Error reading data from Qinglong Panel.\n${e.message}`)});return r}async function T(e,n,r=""){let t=await P(g,"");let a=s.convertToObject(t);let i=s.write(e,n,r,a);t=JSON.stringify(a,null,4);let o=await j(g,"",t);return o&&i}async function J(...n){let e=await P(g,"");let r=s.convertToObject(e);for(let e of n){s.write(e[0],e[1],typeof e[2]!=="undefined"?e[2]:"",r)}e=JSON.stringify(r,null,4);return await j(g,"",e)}async function G(e,n,r,t=s.defaultValueComparator){let a=await P(g,"");let i=s.convertToObject(a);const o=s.update(e,n,r,t,i);let l=false;if(o===true){a=JSON.stringify(i,null,4);l=await j(g,"",a)}return o&&l}async function _(...n){let e=await P(g,"");let r=s.convertToObject(e);for(let e of n){s.update(e[0],e[1],typeof e[2]!=="undefined"?e[2]:"",typeof e[3]!=="undefined"?e["comparator"]:s.defaultValueComparator,r)}e=JSON.stringify(r,null,4);return await j(g,"",e)}async function L(e,n,r="",t=false){let a=await P(g,"");let i=s.convertToObject(a);return s.read(e,n,r,t,i)}async function x(...n){let e=await P(g,"");let r=s.convertToObject(e);let t=[];for(let e of n){const a=s.read(e[0],e[1],typeof e[2]!=="undefined"?e[2]:"",typeof e[3]==="boolean"?e[3]:false,r);t.push(a)}return t}async function D(e,n=""){let r=await P(g,"");let t=s.convertToObject(r);const a=s.del(e,n,t);r=JSON.stringify(t,null,4);const i=await j(g,"",r);return a&&i}async function W(...n){let e=await P(g,"");let r=s.convertToObject(e);for(let e of n){s.del(e[0],typeof e[1]!=="undefined"?e[1]:"",r)}e=JSON.stringify(r,null,4);return await j(g,"",e)}async function z(e){let n=await P(g,"");let r=s.convertToObject(n);return s.allSessionNames(e,r)}async function A(e){let n=await P(g,"");let r=s.convertToObject(n);return s.allSessions(e,r)}return{url:i||s.read("magic_qlurl"),init:t,getToken:v,setEnv:w,setEnvs:E,getEnv:S,getEnvs:O,delEnvs:N,disableEnvs:$,enableEnvs:Q,addScript:q,getScript:P,editScript:j,delScript:k,write:T,read:L,del:D,update:G,batchWrite:J,batchRead:x,batchUpdate:_,batchDel:W,allSessions:A,allSessionNames:z}}
// @formatter:on