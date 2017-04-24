define(function(require, exports, module) {
    'use strict';

    var Promise = require("Promise");
    
    var Router = {
        __site: document.body,
        __startLink: null,    // 执行之前执行
        __endLink: null,    // 执行完毕之后执行
        __notFound: null, // 找不到页面的时候调用
        __validate: null, // 当需要验证的时候执行
        __states: {},
        __listenStates: [],
        __template: null, // 模板
        __currentTemplate: undefined
    };

    Router.listen = function(option) {
        option = option || {};
        if(option.site) Router.__site = option.site;
        if(option.startLink) Router.__startLink = option.startLink;
        if(option.endLink) Router.__endLink = option.endLink;
        if(option.notFound) Router.__notFound = option.notFound;
        if(option.validate) Router.__validate = option.validate;
        var Template = option.template;
        // 初始化 模板。
        if(Template) {
            Router.__template = new Template();
        }

        Router.__listenStates = [];
        // 监听 windows 的 urlHash 值的变化
        window.onhashchange = function (e) {
            var url = getHashUrl(e.newURL);
            walk(url);
        }
        var url = getHashUrl(location.href);
        walk(url);
    }

    Router.linkConfig = function(config) {
        var states = {};
        var recursive = function (parUrl, links, parent) {
            for (var key in links) {
                var parConfig = links[key];
                if(key[0] == '#') key = key.substring(1);
                if(key[0] == '/') key = key.substring(1);
                if(key[key.length - 1] == '/') key = key.substring(0, key.length - 1);
                var parKey = parUrl + "/" + key;
                states[parKey] = linkProcesses(parKey, parConfig, parent);
                if(parConfig.link)
                    recursive(parKey, parConfig.link, states[parKey]);
                delete parConfig.link;
            }
        }
        for (var key in config) {
            var parConfig = config[key];
            if(key[0] == '#') key = key.substring(1);
            if(key[0] == '/') key = key.substring(1);
            if(key[key.length - 1] == '/') key = key.substring(0, key.length - 1);
            states[key] = linkProcesses(key, parConfig, null);
            if(parConfig.link)
                recursive(key, parConfig.link, states[key]);
            delete parConfig.link;
        }
        Router.__states = states;
    }

    // 该方法主要是进入新的连接。（可以生成新的URL地址）
    Router.go = function(url, data) {
        if(data)
            for (var key in data) {
                url = url.replace(new RegExp(":" + key, "gi"), data[key]);
            }
        if(url[0] != "#") url = "#" + url;
        location.href = url;
    }

    // 该方法主要处理 URL 的状态，如：进入、更新、销毁 这些状态
    function walk(url) {
        // 查找匹配链接
        var searchMatch = function(url) {
            for (var key in Router.__states) {
                var state = Router.__states[key];
                if(state.isMatch(url)) {
                    return state;
                }
            }
            return null;
        }
        // 获取主页面
        var indexUrl = url;
        if(indexUrl.indexOf("?") >= 0) indexUrl = indexUrl.substring(0, indexUrl.indexOf("?"));
        indexUrl = indexUrl ? indexUrl + "/index" : "index";
        // 当前进入的链接
        var currentState = searchMatch(indexUrl);
        if(!currentState) currentState = searchMatch(url);
        if(!currentState) {
            // 如果进入这里说明 找不到页面。
            if(Router.__notFound) Router.__notFound(url);
            return;
        }

        var currentRelate = [];
        var tempState = currentState;
        // 当前页面的父子关联。
        do {
            currentRelate.push(tempState);
        } while ((tempState = tempState.parent));
        currentRelate.reverse();

        var nextStep = function() {
            if(Router.__startLink) Router.__startLink(currentState);
            var updateRelate = [],  // 更新关联
                addRelate = [],     // 增加关联
                releaseRelate = []; // 释放的关联
            var i = 0, state_1 = currentRelate[i], state_2 = Router.__listenStates[i];
            do {
                if(state_1 == state_2) {
                    updateRelate.push(state_1);
                } else {
                    if(state_1) addRelate.push(state_1);
                    if(state_2) releaseRelate.push(state_2);
                }
                i = i + 1;
                state_1 = currentRelate[i];
                state_2 = Router.__listenStates[i];
            } while (!(!state_1 && !state_2));
            // 保存关联
            Router.__listenStates = currentRelate;

            actionState(updateRelate, addRelate, releaseRelate, function() {
                // 初始化参数方法
                var state = Router.__listenStates[Router.__listenStates.length - 1];
                var parme = state.getParme(url);
                if(state.config && state.config.event && state.config.event.queryData) state.config.event.queryData(parme);
                if(state.vm) state.vm.$emit("queryData", parme);

                if(Router.__endLink) Router.__endLink(currentState);
            });
        };

        // 验证是否允许通过
        var resolve = null;
        var promise = new Promise(function(res) {
            resolve = res;
        });
        for (var i = 0; i < currentRelate.length; i++) {
            var setThen = function () {
                var tempResolve = null;
                var tempPromise = new Promise(function(res) {
                    tempResolve = res;
                });
                var relate = currentRelate[i];
                promise.then(function(isNext) {
                    if(isNext) {
                        if(Router.__validate && relate.config.validate) {
                            Router.__validate(relate.config.validate, tempResolve);
                        } else {
                            tempResolve(true);
                        }
                    }
                });
                promise = tempPromise;
            };
            setThen();
        }
        promise.then(function(isPass){
            if(isPass) nextStep();
        });
        resolve(true);
    }

    function actionState(updateRelate, addRelate, releaseRelate, callback) {
        // 加载模板
        var lastVM = null;
        // 执行 更新
        for (var i = 0; i < updateRelate.length; i++) {
            var item = updateRelate[i];
            if(item.config && item.config.event && item.config.event.update) item.config.event.updateLink();
            if(!item.vm) continue;
            item.vm.$emit("updateLink");
            lastVM = item.vm.$refs.view;
        }
        // 加载父模板还是子模板
        if(!lastVM) {
            var rootState = Router.__listenStates[0]; 
            var template = rootState.template;
            if(template === undefined) {
                template = Router.__template;
            }
            if(Router.__currentTemplate != template) {
                if(Router.__currentTemplate) {
                    Router.__currentTemplate.$emit("leaveLink");
                    Router.__currentTemplate.$inject(false);
                    Router.__currentTemplate.$mute(true);
                }
                if(template) {
                    template.$emit("enterLink");
                    template.$inject(Router.__site);
                }
                Router.__currentTemplate = template;
            } else if(Router.__currentTemplate) {
                Router.__currentTemplate.$emit("updateLink");
            }
            lastVM = template ? template.$refs.view : Router.__site
        }

        // 执行释放
        for (var i = 0; i < releaseRelate.length; i++) {
            var item = releaseRelate[i];
            if(item.config && item.config.event && item.config.event.leave) item.config.event.leave();
            if(!item.vm) continue;
            item.vm.$emit("leaveLink");
            if(item.config && item.config.cache) {
                item.vm.$inject(false);
                item.vm.$mute(true);
            } else {
                item.vm.destroy();
                item.vm = null;
            }
        }

        var addAction = function() {
            for (var i = 0; i < addRelate.length; i++) {
                var item = addRelate[i];
                if(item.config && item.config.event && item.config.event.enter) item.config.event.enter();
                var View = item.config.view;
                if(item.config && View && !item.vm) item.vm = new View();
                var vm = item.vm;
                if(!vm) continue;
                var injectView = lastVM;
                lastVM = vm.$refs.view;
                vm.$emit("enterLink");
                if(!injectView) continue;
                vm.$inject(injectView);
            }
        }

        // 替换异步View成正常的view
        var promiseArr = [];
        for (var i = 0; i < addRelate.length; i++) {
            var tempFun = function(config) {
                var View = config.view;
                if(View && !View.implement) {
                    promiseArr.push(new Promise(function(resolve) {
                        View(function(view) {
                            config.view = view;
                            resolve();
                        });
                    }));
                }
            };
            tempFun(addRelate[i].config);
        }
        Promise.all(promiseArr).then(function(){
            addAction();
            callback();
        });
    }

    function linkProcesses(stateURL, config, parent) {
        var param_required = /:[a-zA-Z0-9_]+/g;
        var param_not_required = new RegExp("[(](?:[^()]+)[)]", "g");

        var result = "";
        var stateRexVal = stateURL;
        while ((result = param_not_required.exec(stateURL)) != null)  {
            var val = result[0];
            // 替换正则关键字
            var repVal = val.replace(/[?\/\\\^\$\*+\?\{\}\.\|\,\-]/g, function(val) {
                return "[\\" + val + "]";
            });
            // 替换前置 括弧 为无需获取
            repVal = repVal.replace(/[(]/, "(?:");
            // 替换 变量
            repVal = repVal.replace(/:[a-zA-Z0-9_]+/g, "([a-zA-Z0-9_]+)") + "?";
            // 生成 新的 正则
            stateRexVal = stateRexVal.replace(val, repVal);
        }
        // 替换 必填变量
        stateRexVal = stateRexVal.replace(param_required, "([a-zA-Z0-9_]+)");
        // 生成新的正则
        var rex = new RegExp("^" + stateRexVal + "$");

        return Router.__states[stateURL] = {
            parent: parent,
            rex: rex,
            stateURL: stateURL,
            config: config,
            template: config && config.template ? new config.template() : config && config.template === null ? null : undefined,
            // 判断是否匹配
            isMatch: function(url) {
                var where = this.config.where || {};
                var parent = this.parent;
                // 继承 parent 的 where
                while (parent) {
                    if(parent.config.where) {
                        for (var key in parent.config.where) {
                            if(!where[key]) where[key] = parent.config.where[key];
                        }
                    }
                    parent = parent.parent;
                }
                var parmeIsPass = true;
                if(where) {
                    var parme = this.getParme(url);
                    // 判断参数是否合法
                    for (var key in parme) {
                        var parmeWhere = where[key];
                        if(!parmeWhere) continue;
                        if(typeof parmeWhere == 'string') parmeWhere = new RegExp(parmeWhere);
                        if(!parmeWhere.test(parme[key])) {
                            parmeIsPass = false;
                            break;
                        }
                    }
                }
                if(url.indexOf("?") >= 0)
                    url = url.substring(0, url.indexOf("?"));
                return this.rex.test(url) && parmeIsPass;
            },
            // 获取参数
            getParme: function (u) {
                var parme = {};
                var url = u;
                if(url.indexOf("?") >= 0) url = url.substring(0, url.indexOf("?"));
                if(this.rex.test(url)) {
                    var parmeRegx = /:[a-zA-Z0-9_]+/gi;
                    var parmeNameArr = [];
                    var parmeName = null;
                    // 获取变量名称
                    while ((parmeName = parmeRegx.exec(this.stateURL)) != null) {
                        parmeNameArr.push(parmeName[0].replace(":", ""));
                    }
                    var parmeVals = this.rex.exec(url).slice(1);
                    for (var i = 0; i < parmeNameArr.length; i++) {
                        var name = parmeNameArr[i];
                        var val = parmeVals[i];
                        if(val !== undefined) parme[name] = val;
                    }
                }
                var queryData = GetUrlQueryData(u);
                for (var key in queryData) {
                    parme[key] = queryData[key];
                }
                return parme;
            }
        };
    }

    // --------------- 工具方法 -------------------
    // 根据URL获取URL里面的 变量名称
    function GetQueryName(url) {
        var reg = new RegExp("[&?]([a-zA-Z0-9_]+)[=]", "g");
        var name = null;
        var names = [];
        while ((name = reg.exec(url)) != null) {
            names.push(name[1]);
        }
        return names;
    }
    // 根据参数名，从URL 里面获取值
    function GetQueryString(url, name)
    {
        var reg = new RegExp("[?&]"+ name +"=([^&]*)[&]?");
        var r = url.match(reg);
        if(r!=null)return unescape(r[1]); return null;
    }
    // 根据 URL 获得参数
    function GetUrlQueryData(url) {
        var names = GetQueryName(url);
        var data = {};
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            data[name] = GetQueryString(url, name);
        }
        return data;
    }
    function getHashUrl(url) {
        var regConstructorReplace = /^[^#]*/,
            regConstructorWhich = /^(#[^#]*)(#?.*)$/;
        url = url.replace(regConstructorReplace, '');
        if(!url) return "";
        var matches = url.match(regConstructorWhich);
        var _hash = matches[1];

        return _hash.replace(/^[#!?\/]+/, '');
    }

    module.exports = Router;
});