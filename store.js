// アプリケーションの状態を保持する store
// store の更新は必ず ACTION による trigger 経由で行う
// 参照は自由に行って良い
// store は ACTION による更新が行われると CHANGE による通知を行う

// ACTION は store の変更を行う
// CHANGE の数字とかぶってはいけない
// view -> store 
const ACTION = {
    APP_QUIT: 0,

    DIALOG_FILE_OPEN: 10,
    DIALOG_MODAL_MESSAGE: 11,
    DIALOG_MODAL_ERROR: 12,

    FILE_OPEN: 20,
    FILE_RELOAD: 21,
    FILE_CHECK_RELOAD: 22,

    TAB_CLOSE: 32,
    TAB_ACTIVATE: 33,
    TAB_MOVE: 34,

    SHEET_RESIZE: 40,       // シートサイズの変更
    PANE_SPLITTER_MOVE: 50, // スプリッタ位置の変更

    KONATA_CHANGE_COLOR_SCHEME: 60,  // カラースキームの変更
    KONATA_TRANSPARENT: 61, // 透過モードの設定
    KONATA_SYNC_SCROLL: 62, // 同期スクロール

    KONATA_ZOOM: 63,        // 拡大/縮小
    KONATA_MOVE_WHEEL: 65,  // ホイールによるスクロール
    KONATA_MOVE_PIXEL_DIFF: 66,   // 位置移動，引数はピクセル相対値
    KONATA_MOVE_LOGICAL_POS: 67,  // 位置移動，引数は論理座標（サイクル数，命令ID）

    KONATA_SET_DEP_ARROW_TYPE: 68,  // 依存関係の矢印のタイプの設定
    KONATA_SPLIT_LANES: 69, // レーンを分割して表示するか
    KONATA_FIX_OP_HEIGHT: 70,   // レーン分割時に高さを一定にするかどうか

};

// CHANGE は store で行われた変更の通知に使う
// ACTION の数字とかぶってはいけない
// store -> view
const CHANGE = {
    TAB_OPEN: 100,
    TAB_UPDATE: 101,    // タブ切り替え時の更新

    PANE_SIZE_UPDATE: 102,
    PANE_CONTENT_UPDATE: 103,   // ペーンの中身の更新

    DIALOG_FILE_OPEN: 110,
    DIALOG_MODAL_MESSAGE: 111,
    DIALOG_MODAL_ERROR: 112,
    DIALOG_CHECK_RELOAD: 113,

    MENU_UPDATE: 120,   // メニュー内容の更新
};

class Store{
    constructor(){
        /* globals riot */
        riot.observable(this);
        
        // この書式じゃないと IntelliSense が効かない
        let electron = require("electron");
        let KonataRenderer = require("./konata_renderer");
        let Konata = require("./konata");
        let fs = require("fs");


        // Tab
        this.tabs = {}; // id -> tab
        this.nextOpenedTabID = 0; // 次にオープンされるタブの ID 

        this.activeTabID = 0;   // 現在アクティブなタブの ID 
        this.activeTab = null;  // 現在アクティブなタブ
        this.prevTabID = -1;     // 前回アクティブだったタブの ID 
        this.prevTab = null;       // 前回アクティブだったタブ

        // ウィンドウサイズ
        this.sheet = {
            width: 800,
            height: 600
        };

        // 依存関係の矢印のタイプ
        this.depArrowType = KonataRenderer.DEP_ARROW_INSIDE_LINE;
        this.splitLanes = false;
        this.fixOpHeight = false;

        // アニメーション
        this.inAnimation = false;
        this.animationID = 0;

        // ズームのアニメーション
        this.zoomEndLevel = 0;
        this.curZoomLevel = 0;
        this.zoomBasePoint = [0, 0];
        this.zoomAnimationDirection = false;
        let ZOOM_ANIMATION_SPEED = 0.2;

        // スクロールのアニメーション
        this.scrollEndPos = [0, 0];
        this.curScrollPos = [0, 0];
        this.scrollAnimationDiff = [0, 0];
        this.scrollAnimationDirection = [false, false];
        let SCROLL_ANIMATION_PERIOD = 70;  // ミリ秒

        let self = this;
        

        // ダイアログ
        // 基本的に中継してるだけ
        self.on(ACTION.DIALOG_FILE_OPEN, function(){
            self.trigger(CHANGE.DIALOG_FILE_OPEN);
        });
        self.on(ACTION.DIALOG_MODAL_MESSAGE, function(msg){
            self.trigger(CHANGE.DIALOG_MODAL_MESSAGE, msg);
        });
        self.on(ACTION.DIALOG_MODAL_ERROR, function(msg){
            self.trigger(CHANGE.DIALOG_MODAL_ERROR, msg);
        });

        // ファイルオープン
        self.on(ACTION.FILE_OPEN, function(fileName){
            // Load a file
            let konata = new Konata.Konata();
            if (!konata.openFile(fileName)) {
                konata.close();
                self.trigger(CHANGE.DIALOG_MODAL_ERROR, `${fileName} の読み込みに失敗しました．`);
                return;
            }
            let renderer = new KonataRenderer.KonataRenderer();
            renderer.init(konata);

            // ファイル更新時間
            let mtime = fs.statSync(fileName).mtime;

            // Create a new tab
            let tab = {
                id: self.nextOpenedTabID, 
                fileName: fileName,
                lastFileCheckedTime: mtime,
                konata: konata,
                renderer: renderer,
                splitterPos: 300,   // スプリッタの位置
                transparent: false, // 透明化の有効無効
                colorScheme: "Auto",  // カラースキーム
                syncScroll: false,  // スクロールを同期 
                syncScrollTab: 0,    // 同期対象のタブ
                viewPort: {         // 表示領域
                    top: 0,
                    left: 0,
                    width: 0,
                    height: 0,
                },  
            };
            self.tabs[self.nextOpenedTabID] = tab;
            self.activeTabID = self.nextOpenedTabID;
            self.activeTab = self.tabs[self.activeTabID];
            self.nextOpenedTabID++;
        
            self.trigger(CHANGE.TAB_OPEN, tab);
            self.trigger(CHANGE.TAB_UPDATE, tab);
            self.trigger(CHANGE.PANE_SIZE_UPDATE);
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
            self.trigger(CHANGE.MENU_UPDATE);
        });

        // ファイルリロード
        self.on(ACTION.FILE_RELOAD, function(){
            let konata = self.activeTab.konata;
            konata.openFile(self.activeTab.fileName);
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
        });

        // リロードのチェック要求
        self.on(ACTION.FILE_CHECK_RELOAD, function(){
            if (!self.activeTab) {
                return;
            }
            // ファイル更新時間
            let fileName = self.activeTab.fileName;
            let mtime = fs.statSync(fileName).mtime;
            if (self.activeTab.lastFileCheckedTime < mtime){
                // リロードチェックのダイアログを起動
                self.trigger(CHANGE.DIALOG_CHECK_RELOAD, fileName);
            }
            self.activeTab.lastFileCheckedTime = mtime;
        });


        // アクティブなタブの変更
        self.on(ACTION.TAB_ACTIVATE, function(id){
            if (!(id in self.tabs)) {
                console.log(`ACTION.TAB_ACTIVATE: invalid id: ${id}`);
                return;
            }

            self.prevTabID = self.activeTabID;
            self.prevTab = self.activeTab;

            self.activeTabID = id;
            self.activeTab = self.tabs[self.activeTabID];

            self.trigger(CHANGE.TAB_UPDATE);
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
            self.trigger(CHANGE.MENU_UPDATE);
        });

        // タブ移動
        self.on(ACTION.TAB_MOVE, function(next){
            let ids = Object.keys(self.tabs).sort();
            for (let i = 0; i < ids.length; i++) {
                if (self.activeTab.id == ids[i]) {
                    let to = next ? ids[(i+1)%ids.length] : ids[(i+ids.length-1)%ids.length];
                    self.trigger(ACTION.TAB_ACTIVATE, to);
                    break;
                }
            }
        });

        // タブを閉じる
        self.on(ACTION.TAB_CLOSE, function(id){
            if (!(id in self.tabs)) {
                console.log(`ACTION.TAB_CLOSE: invalid id: ${id}`);
                return;
            }

            delete self.tabs[id];
            self.activeTab = null;
            for(let newID in self.tabs){
                self.activeTabID = newID;
                self.activeTab = self.tabs[newID];
                break;
            }
            if (!self.activeTab) {
                self.activeTabID = -1;
            }
            self.trigger(CHANGE.TAB_UPDATE);
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
            self.trigger(CHANGE.MENU_UPDATE);
        });

        // ウィンドウのサイズ変更
        self.on(ACTION.SHEET_RESIZE, function(width, height){
            self.sheet.width = width;
            self.sheet.height = height;
            self.trigger(CHANGE.PANE_SIZE_UPDATE);
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
        });

        // スプリッタの位置変更
        self.on(ACTION.PANE_SPLITTER_MOVE, function(position){
            if (!self.activeTab) {
                return;
            }
            self.activeTab.splitterPos = position;
            self.trigger(CHANGE.PANE_SIZE_UPDATE);
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
        });

        // アプリケーション終了
        self.on(ACTION.APP_QUIT, function(){
            electron.remote.app.quit();
        });


        // ズームのスタート
        self.startZoom = function(zoomLevelDiff, offsetX, offsetY){
            if (!self.inAnimation) {
                // 拡大 or 縮小
                self.zoomAnimationDirection = zoomLevelDiff > 0;
                self.curZoomLevel = self.activeTab.renderer.zoomLevel;
                self.zoomEndLevel = 
                    self.curZoomLevel + zoomLevelDiff;
                self.zoomBasePoint = [offsetX, offsetY];
                self.inAnimation = true;
                self.animationID = setInterval(self.animateZoom, 16);
            }
        };

        // ズームアニメーション中は，一定時間毎に呼び出される
        self.animateZoom = function(){
            if (!self.inAnimation) {
                return;
            }

            self.curZoomLevel += 
                self.zoomAnimationDirection ? ZOOM_ANIMATION_SPEED : -ZOOM_ANIMATION_SPEED;
            
            self.zoomAbs(
                self.curZoomLevel, 
                self.zoomBasePoint[0], 
                self.zoomBasePoint[1]
            );

            if ((self.zoomAnimationDirection && self.curZoomLevel >= self.zoomEndLevel) ||
                (!self.zoomAnimationDirection && self.curZoomLevel <= self.zoomEndLevel)){
                self.inAnimation = false;
                clearInterval(self.animationID);
                self.zoomAbs(
                    self.zoomEndLevel, 
                    self.zoomBasePoint[0], 
                    self.zoomBasePoint[1]
                );
            }
        };

        // 拡大/縮小
        // zoomLevel は zoom level の値
        // posX, posY はズームの中心点
        self.zoomAbs = function(zoomLevel, posX, posY){
            if (!self.activeTab) {
                return;
            }
            let renderer = self.activeTab.renderer;
            renderer.zoomAbs(zoomLevel, posX, posY);
            // 同期
            if (self.activeTab.syncScroll) {
                let renderer = self.activeTab.syncScrollTab.renderer;
                renderer.zoomAbs(zoomLevel, posX, posY);
            }
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
        };

        // 拡大/縮小
        // zoomLevelDiff は zoom level の差分
        // posX, posY はズームの中心点
        self.on(ACTION.KONATA_ZOOM, function(zoomLevelDiff, posX, posY){
            if (!self.activeTab || self.inAnimation) {
                return;
            }
            self.startZoom(zoomLevelDiff, posX, posY);
        });


        // スクロールのアニメーションのスタート
        self.startScroll = function(scrollDiff){
            if (self.inAnimation) {
                self.finishScroll();
            }
            self.scrollAnimationDiff = scrollDiff;
            self.scrollAnimationDirection = [scrollDiff[0] > 0, scrollDiff[1] > 0];
            self.curScrollPos = self.activeTab.renderer.viewPos;
            self.scrollEndPos = [
                self.curScrollPos[0] + scrollDiff[0],
                self.curScrollPos[1] + scrollDiff[1]
            ];
            self.inAnimation = true;
            self.animationID = setInterval(self.animateScroll, 16);
        };

        // アニメーション中は，一定時間毎に呼び出される
        self.animateScroll = function(){
            if (!self.inAnimation) {
                return;
            }

            let diff = self.scrollAnimationDiff;
            let dir = self.scrollAnimationDirection;
            let frames = SCROLL_ANIMATION_PERIOD / 16;
            self.curScrollPos[0] += diff[0] / frames;
            self.curScrollPos[1] += diff[1] / frames;
            
            self.trigger(ACTION.KONATA_MOVE_LOGICAL_POS, self.curScrollPos);

            if (((dir[0] && self.curScrollPos[0] >= self.scrollEndPos[0]) ||
                (!dir[0] && self.curScrollPos[0] <= self.scrollEndPos[0])) &&
                ((dir[1] && self.curScrollPos[1] >= self.scrollEndPos[1]) ||
                (!dir[1] && self.curScrollPos[1] <= self.scrollEndPos[1]))
            ){
                self.inAnimation = false;
                clearInterval(self.animationID);
                self.trigger(ACTION.KONATA_MOVE_LOGICAL_POS, self.scrollEndPos);
            }
        };

        // スクロールの強制終了
        self.finishScroll = function(){
            self.inAnimation = false;
            clearInterval(self.animationID);
            self.trigger(ACTION.KONATA_MOVE_LOGICAL_POS, self.scrollEndPos);
        };

        // ホイールによる移動
        self.on(ACTION.KONATA_MOVE_WHEEL, function(wheelUp){
            if (!self.activeTab) {
                return;
            }
            let renderer = self.activeTab.renderer;
            let scale = renderer.zoomScale;
            let diffY = (wheelUp ? 3 : -3) / scale;
            let diffX = renderer.adjustScrpllDiifX(diffY);
            self.startScroll([diffX, diffY]);
        });

        // 位置移動，引数はピクセル相対値
        self.on(ACTION.KONATA_MOVE_PIXEL_DIFF, function(diff){
            if (!self.activeTab) {
                return;
            }
            let renderer = self.activeTab.renderer;
            renderer.movePixelDiff(diff);
            // 同期
            if (self.activeTab.syncScroll) {
                let renderer = self.activeTab.syncScrollTab.renderer;
                renderer.movePixelDiff(diff);
            }
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
        });

        // 位置移動，引数は論理座標（サイクル数，命令ID）
        self.on(ACTION.KONATA_MOVE_LOGICAL_POS, function(pos){
            if (!self.activeTab) {
                return;
            }
            let renderer = self.activeTab.renderer;
            renderer.moveLogicalPos(pos);
            // 同期
            if (self.activeTab.syncScroll) {
                let renderer = self.activeTab.syncScrollTab.renderer;
                renderer.moveLogicalPos(pos);
            }
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
        });

        // カラースキームの変更
        self.on(ACTION.KONATA_CHANGE_COLOR_SCHEME, function(tabID, scheme){
            if (!(tabID in self.tabs)) {
                return;
            }
            let tab = self.tabs[tabID];
            tab.colorScheme = scheme;
            tab.renderer.changeColorScheme(scheme);
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
            self.trigger(CHANGE.MENU_UPDATE);
        });

        // 依存関係の矢印のタイプを変更
        self.on(ACTION.KONATA_SET_DEP_ARROW_TYPE, function(type){
            self.depArrowType = type;
            for (let tabID in self.tabs) {
                self.tabs[tabID].renderer.depArrowType = type;
            }
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
            self.trigger(CHANGE.MENU_UPDATE);
        });

        // レーンを分割して表示するか
        self.on(ACTION.KONATA_SPLIT_LANES, function(enabled){
            self.splitLanes = enabled;
            for (let tabID in self.tabs) {
                self.tabs[tabID].renderer.splitLanes = enabled;
            }
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
            self.trigger(CHANGE.MENU_UPDATE);
        });

        // レーン分割時に高さを一定にするかどうか
        self.on(ACTION.KONATA_FIX_OP_HEIGHT, function(enabled){
            self.fixOpHeight = enabled;
            for (let tabID in self.tabs) {
                self.tabs[tabID].renderer.fixOpHeight = enabled;
            }
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
            self.trigger(CHANGE.MENU_UPDATE);
        });

        // パイプラインのペーンを透明化
        self.on(ACTION.KONATA_TRANSPARENT, function(tabID, enable){
            if (!(tabID in self.tabs)) {
                return;
            }
            let tab = self.tabs[tabID];
            tab.transparent = enable;
            self.trigger(CHANGE.TAB_UPDATE);
            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
            self.trigger(CHANGE.MENU_UPDATE);
        });

        // スクロールの同期化
        self.on(ACTION.KONATA_SYNC_SCROLL, function(tabID, syncedTabID, enable){

            if (!(tabID in self.tabs)) {
                return;
            }
            let tab = self.tabs[tabID];

            if (enable) {
                if (!(syncedTabID in self.tabs)) {
                    return;
                }
                tab.syncScroll = true;
                tab.syncScrollTab = self.tabs[syncedTabID];
            }
            else{
                tab.syncScroll = false;
                tab.syncScrollTab = null;
            }

            self.trigger(CHANGE.MENU_UPDATE);
        });
    }

}


module.exports = Store;
