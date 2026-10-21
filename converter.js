// author: (c) 2011 by Lorenz Lo Sauer; lsauer.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// Design 10/2011 by Lo Sauer, MIT-LICENSE or BSD-LICENSE
// Design of the Chromium Logo by Google Inc.; Parts are Chrome CSS - BSD license applies
//
// Project: https://github.com/lsauer/chrome-session-restore
//
// ---------------------------------------------------------------------------
// BSD 3-Clause License
//
// Copyright (c) 2011, Lorenz Lo Sauer (lsauer.com)
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice,
//    this list of conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice,
//    this list of conditions and the following disclaimer in the documentation
//    and/or other materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its
//    contributors may be used to endorse or promote products derived from
//    this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.
// ---------------------------------------------------------------------------
//
// Tab group support added: the session file (SNSS) is now parsed as a binary
// command stream so tab -> group assignments and group metadata (title, color,
// collapsed) can be recovered. Files that are not SNSS fall back to the old
// "scan for URLs" behaviour.

/**
* islib: see here for more; any unused functions are stripped
*/
var is = (function(){
  return {
	xhrStatus : {},
	Debug : false,
	get FileAccess()  { return typeof(window.File) !== 'undefined' && typeof(window.FileReader) === 'function' && typeof(window.FileList) !== 'undefined'; },
	get DragSupport()    { var el = document.getElementsByTagName('body')[0]; if(!el) return false; else return el.hasOwnProperty('ondragenter') && el.hasOwnProperty('ondragend'); },
  }})();

/**
* simple multi timer
*/
j2timer();
function j2timer(e){
	window.tdiff || (window.tdiff = []);
	window.tdlog || (window.tdlog = []);
	window.fnred || (window.fnred = function(a,b){return a-b;});

	//toggle statement
	if( (tdiff.length+1) % 2){
		tdiff.push( Date.now());
		return;
	}
	tdlog.push(["TIMER:", Date.now()-tdiff[tdiff.length-1], "[msec]; NOW:", Date.now(), "; WHO:", e, this.constructor.toString().split("(")[0]]);
}

//------------IMPLEMENTATION----------------//
function eventstop(e){
	e.stopPropagation();
	e.preventDefault();
};

/**
* concise element selector function; 09/2011
*/
function gEl(name){ //get Element by name [+childName]
	if( document.getElementById(name) != undefined )
		return document.getElementById(name);
	else
		return document.getElementsByName(name)[0]; //first el is returned!
}

function gel(name, child){ //get Element by name [+childName]
	var el;
	if( name instanceof HTMLElement )
		el = name;
	else
		if( document.getElementById(name) != undefined )
			el = document.getElementById(name);
		else
			el = document.getElementsByName(name)[0];
	if(child === undefined || el === undefined)
		return el;

	var regx = new RegExp(child, "gi");
	for(var i=0, els = el.children; i<els.length; i++ ){
		if( regx.test(els[i].tagName) || regx.test(els[i].id) ){
			return els[i];
		}
	}
	for(var i=0, els = el.parentNode.children; i<els.length; i++ ){
		if( regx.test(els[i].tagName) || regx.test(els[i].id) ){
			return els[i];
		}
	}
}

/**
* HTMLElement Class- Functions. Elements can have several classes which are separated by a space ' '
*/
Classy = function(el){
	return {
		self : el,
		has : function (cls, ele) {
				if( this.self ) ele =  this.self;
				return ele.className.match(new RegExp('(\\s|^)' + cls + '(\\s|$)'));
			},
		add : function (cls, ele) {
			if( this.self ) ele =  this.self;
			if (!this.has(cls, ele)) ele.className += " " + cls;
		},
		del : function (cls, ele) {
			if( this.self ) ele =  this.self;
			if (this.has(cls, ele)) {
				var reg = new RegExp('(\\s|^)' + cls + '(\\s|$)');
				ele.className = ele.className.replace(reg, ' ');
			}
		},
		repl : function (cls, ele)  {
			if( this.self ) ele =  this.self;
			if(!this.has(cls, ele)) {
				this.add(cls, ele);
			}
		}
	};
};

/**
* SNSS session file parser (Chromium "Current Session" / "Last Session" / "Tabs_*")
*
* File layout: 'SNSS' + int32 version, then commands:
*   uint16 size | uint8 commandId | (size-1) bytes payload
*/
var SNSS = (function(){
	var CMD = {
		UpdateTabNavigation : 6,
		SetSelectedNavigationIndex : 7,
		SetPinnedState : 12,
		TabClosed : 16,
		SetTabGroup : 25,
		SetTabGroupMetadata : 26,   // deprecated; layout differs, ignored in favour of v2
		SetTabGroupMetadata2 : 27
	};
	// tab_groups::TabGroupColorId order
	var COLORS = ['grey','blue','red','yellow','green','pink','purple','cyan','orange'];

	function hex(n){ return ('00000000'+n.toString(16)).slice(-8); }

	function Reader(dv, off, end){ this.dv = dv; this.o = off; this.end = end; }
	Reader.prototype = {
		left : function(){ return this.end - this.o; },
		i32 : function(){ var v = this.dv.getInt32(this.o, true); this.o += 4; return v; },
		u64 : function(){ var lo = this.dv.getUint32(this.o, true), hi = this.dv.getUint32(this.o+4, true); this.o += 8; return hex(hi)+hex(lo); },
		str : function(){ //utf-8 string, 4 byte aligned
			var n = this.i32();
			if(n < 0 || n > this.left()) throw new Error('bad string');
			var s = new TextDecoder('utf-8').decode(new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.o, n));
			this.o += (n + 3) & ~3;
			return s;
		},
		str16 : function(){ //utf-16 string, 4 byte aligned
			var n = this.i32();
			if(n < 0 || n*2 > this.left()) throw new Error('bad string16');
			var s = new TextDecoder('utf-16le').decode(new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.o, n*2));
			this.o += (n*2 + 3) & ~3;
			return s;
		}
	};

	function isSNSS(buf){
		if(buf.byteLength < 8) return false;
		var u = new Uint8Array(buf, 0, 4);
		return u[0]===0x53 && u[1]===0x4e && u[2]===0x53 && u[3]===0x53;
	}

	function parse(buf){
		var dv = new DataView(buf);
		var pos = 8, len = buf.byteLength;
		var tabs = {};      // tabId -> {id, navs:{idx:{url,title}}, sel, group, pinned, closed}
		var groups = {};    // token -> {token, title, color, collapsed}
		var order = [];

		function tab(id){
			if(!tabs[id]){ tabs[id] = {id:id, navs:{}, sel:null, group:null, pinned:false, closed:false}; order.push(id); }
			return tabs[id];
		}

		while(pos + 3 <= len){
			var size = dv.getUint16(pos, true);
			if(size < 1 || pos + 2 + size > len) break; // truncated / corrupted tail
			var id = dv.getUint8(pos + 2);
			var ps = pos + 3, pe = pos + 2 + size; // payload range
			try {
				if(id === CMD.UpdateTabNavigation){
					var r = new Reader(dv, ps + 4, pe); // skip pickle size header
					var tid = r.i32(), idx = r.i32(), url = r.str(), title = r.str16();
					tab(tid).navs[idx] = {url:url, title:title};
				} else if(id === CMD.SetSelectedNavigationIndex){
					tab(dv.getInt32(ps, true)).sel = dv.getInt32(ps+4, true);
				} else if(id === CMD.SetPinnedState){
					tab(dv.getInt32(ps, true)).pinned = !!dv.getUint8(ps+4);
				} else if(id === CMD.TabClosed){
					tab(dv.getInt32(ps, true)).closed = true;
				} else if(id === CMD.SetTabGroup){
					var plen = pe - ps, tid2 = dv.getInt32(ps, true), ho, lo, hasOff;
					if(plen >= 32){ ho = ps+8; lo = ps+16; hasOff = ps+24; }   // 8-byte aligned struct
					else          { ho = ps+4; lo = ps+12; hasOff = ps+20; }   // packed struct
					var high = dv.getUint32(ho+4, true), highLo = dv.getUint32(ho, true);
					var low2 = dv.getUint32(lo+4, true), lowLo = dv.getUint32(lo, true);
					var token = hex(high)+hex(highLo)+hex(low2)+hex(lowLo); // same format as Reader.u64() x2
					var has = dv.getUint8(hasOff);
					tab(tid2).group = has ? token : null;
				} else if(id === CMD.SetTabGroupMetadata2){
					var r2 = new Reader(dv, ps + 4, pe); // skip pickle size header
					var hi = r2.u64(), lw = r2.u64(); // each u64 printed hi32+lo32 -> see note below
					var title2 = r2.str();
					var color = r2.left() >= 4 ? r2.i32() : 0;
					var coll  = r2.left() >= 4 ? !!r2.i32() : false;
					// u64() prints hi word then lo word; token in SetTabGroup is printed the same way.
					var tk = hi + lw;
					groups[tk] = {token:tk, title:title2, color:COLORS[color] || 'grey', collapsed:coll};
				}
			} catch(ex){ if(is.Debug) console.log('SNSS command', id, 'skipped:', ex); }
			pos = pe;
		}

		// resolve each tab to its currently selected navigation entry
		var out = [];
		order.forEach(function(tid){
			var t = tabs[tid]; if(t.closed) return;
			var idxs = Object.keys(t.navs).map(Number).sort(function(a,b){return a-b;});
			if(!idxs.length) return;
			var nav = t.navs[t.sel] || t.navs[idxs[idxs.length-1]];
			if(!nav || !nav.url) return;
			out.push({id:tid, url:nav.url, title:nav.title, group:t.group, pinned:t.pinned});
		});
		return {tabs:out, groups:groups};
	}

	return {isSNSS:isSNSS, parse:parse, COLORS:COLORS};
})();

/** Fallback for non-SNSS files: scan text for URLs (original behaviour). */
function scanUrls(buf){
	var text = new TextDecoder('latin1').decode(new Uint8Array(buf));
	var urls = text.split(/(?=(?:ftp|http|htttp):\/\/)/)
		.filter(function(v){return v.length>6})
		.map(function(v){ var a=v.match(/(^(?:ftp|http|htttp):\/\/[a-z0-9|&!%$()?.\/=+#-;]+)/ig); if(a && a.length) return a.pop(); })
		.filter(String);
	return {tabs: urls.map(function(u,i){ return {id:i, url:u, title:'', group:null, pinned:false}; }), groups:{}};
}

function escHtml(s){
	return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
* ONLOAD Functions
*/
window.onload = function(){
	document.addEventListener('click',
		function(){ gEl('recent-menu').style.display = "none"; }
	);
	//add toggle listener
	gel('recently-closed-menu-button').onclick = function(e){
		var el = gEl('recent-menu');
		if(el.style.display === 'none')
			el.style.display = 'block';
		else
			el.style.display = 'none';

		//without cancelBubble, the event would bubble to document, which would set the menu display to none!
		e.cancelBubble = true;
		return;
	};

	//converter codebase
	j2 = {
		fLarge : 3000000,
		elLi : 			gEl('liWebservice'),
		elLiOpt : 		gEl('liOptions'),
		elSp : 			gEl('spWservtxt'),
		elIF : 			gEl('jsonfiles'),
		elTxtBxj :		gEl('footer'),
		elFlist : 		gEl('fileslist'),
		elChkRev :		gEl('sql2json'),
		elChkFget :		gEl('getfile'),
		elChkCompr :	gEl('compress'),
		cls :			new Classy( gel('gEl') ),
		data : 			null,
		freader : 		new FileReader(),
		win	: 			null,
	};

	function openTabsWin(url, name) {
		j2.win = window.open(url, window.name);
		if(j2.win) j2.win.focus();
		return false;
	}

	function tabLink(t, label){
		var host = (t.url.match(/^[a-z]+:\/\/([^\/?#]+)/i) || [])[1] || t.url;
		var text = label || t.title || host;
		return '<a class="recent-menu-item" href="'+escHtml(t.url)+'" title="'+escHtml(t.url)+'" style="background-image: url(res/ico/link16.png);">'+
			(t.pinned ? '&#128204; ' : '') + escHtml(text) + '</a>';
	}

	/** build the menu: "N Tab(s)" opener, then pinned/ungrouped tabs, then each tab group */
	function renderMenu(result, maxopen){
		var elmenu = gel('recent-menu');
		var tabs = result.tabs, groups = result.groups;
		var byGroup = {}, ungrouped = [], groupOrder = [];
		tabs.forEach(function(t){
			if(t.group){
				if(!byGroup[t.group]){ byGroup[t.group] = []; groupOrder.push(t.group); }
				byGroup[t.group].push(t);
			} else ungrouped.push(t);
		});

		var html = '';
		ungrouped.forEach(function(t){ html += tabLink(t); });

		groupOrder.forEach(function(tk){
			var g = groups[tk] || {title:'', color:'grey', collapsed:false};
			var name = g.title || '(unnamed group)';
			html += '<div class="tabgroup tabgroup-'+g.color+'" data-group="'+escHtml(tk)+'">'+
				'<a href="#" class="tabgroup-header" data-open="'+escHtml(tk)+'" title="Open all tabs in this group">'+
				'<span class="tabgroup-chip"></span>'+escHtml(name)+' <small>('+byGroup[tk].length+' tab'+(byGroup[tk].length===1?'':'s')+
				(g.collapsed ? ', collapsed' : '')+')</small></a>';
			byGroup[tk].forEach(function(t){ html += tabLink(t); });
			html += '</div>';
		});
		elmenu.innerHTML = html;

		//header click opens the whole group (user-initiated, so popups are allowed)
		Array.prototype.forEach.call(elmenu.querySelectorAll('.tabgroup-header'), function(a){
			a.onclick = function(e){
				eventstop(e);
				byGroup[a.getAttribute('data-open')].slice(0, maxopen).forEach(function(t){ openTabsWin(t.url); });
			};
		});

		//create open all tabs link
		var ela = document.createElement('a');
		ela.href = '#';
		ela.className = "recent-window recent-menu-item";
		ela.innerHTML = tabs.length+' Tab(s)' + (groupOrder.length ? ', '+groupOrder.length+' group(s)' : '');
		ela.onclick = function(e){ eventstop(e); tabs.slice(0,maxopen).forEach(function(t){ openTabsWin(t.url); }); };
		elmenu.insertBefore(ela, elmenu.firstChild);

		console.log(tabs, groups);
	}

	//hide file-input box on FileReader browsers
	if( is.FileAccess && is.DragSupport ){
		j2.elIF.style.display = 'none';
	}else{
		j2.elIF.onchange = function(e)
		{
			var files;
			if( e instanceof MouseEvent ){
				files = e.dataTransfer.files;
			} else if( e instanceof Event && j2.elIF.files instanceof FileList ){
				files =  j2.elIF.files;
			}else{
				console.log("FILE accession unsucessful", e);
				return false;
			}
			if(j2.freader && j2.freader.onload){
				j2.freader.readAsArrayBuffer(files[0]);
			}
			eventstop(e);
		}
	}

	/**
	* DnD Uploader logic
	*/
	function xhrUploader(el) {
		var freader = j2.freader;
		if( is.FileAccess ) {

			freader.onerror = function(e) { console.error('File error', e, e.target); };
			freader.onabort = function(e) { console.error('File read cancelled'); };

			freader.onload = function(e)
			{
				var maxopen = +gel('maxtabs').value || 5;	//max number of popups to open
				var buf = e.target.result;
				j2.data = buf;
				var result;
				try {
					result = SNSS.isSNSS(buf) ? SNSS.parse(buf) : scanUrls(buf);
				} catch(ex){
					console.error('SNSS parse failed, falling back to URL scan', ex);
					result = scanUrls(buf);
				}
				renderMenu(result, maxopen);
			};

			el.ondrop = function(e)
			{
				eventstop(e);
				for (var i = 0; i < e.dataTransfer.files.length; i++) {
					freader.readAsArrayBuffer(e.dataTransfer.files[i]);
				}
				if(j2.elIF.onchange)
					j2.elIF.onchange(e);
			};

			el.ondragenter = el.ondragstart = function(e) {
				eventstop(e); /*must be on top for Firefox*/
				e.target.className += /(jtxtactive)/ig.test(e.target.className) ? '' : ' jtxtactive';
			};
			el.dragend = el.ondragleave = function(e) {
				eventstop(e);
				e.target.className = e.target.className.replace(/[\s]*jtxtactive[\s]*/ig, ' ');
			};
			el.addEventListener('dragover', function(e) {
				eventstop(e);
			}, false);
			console.log("DnD event listener added");
		}
	};
	//create a new uploader instance
	xhrUpld = xhrUploader( j2.elTxtBxj );
};