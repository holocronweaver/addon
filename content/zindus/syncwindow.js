/* ***** BEGIN LICENSE BLOCK *****
 * 
 * "The contents of this file are subject to the Mozilla Public License
 * Version 1.1 (the "License"); you may not use this file except in
 * compliance with the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 * 
 * Software distributed under the License is distributed on an "AS IS"
 * basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the
 * License for the specific language governing rights and limitations
 * under the License.
 * 
 * The Original Code is Zindus Sync.
 * 
 * The Initial Developer of the Original Code is Toolware Pty Ltd.
 *
 * Portions created by Initial Developer are Copyright (C) 2007-2008
 * the Initial Developer. All Rights Reserved.
 * 
 * Contributor(s): Leni Mayo
 * 
 * ***** END LICENSE BLOCK *****/

includejs("payload.js");

function SyncWindow()
{
	// logging enabled for issue #50
	//
	this.m_logger    = newLogger("SyncWindow"); // this.m_logger.level(Logger.NONE);

	this.m_logger.debug("constructor starts");

	this.m_syncfsm   = null;
	this.m_timeoutID = null; // timoutID for the next schedule of the fsm
	this.m_payload   = null; // we keep it around so that we can pass the results back
	this.m_zwc       = new WindowCollection(SHOW_STATUS_PANEL_IN);

	this.m_has_observer_been_called = false;

	this.m_logger.debug("constructor ends");
}

SyncWindow.prototype.onLoad = function()
{
	this.m_logger.debug("onLoad: enters");

	this.m_payload = window.arguments[0];

	this.m_logger.debug("is_cancelled " + this.m_payload.m_is_cancelled);

	if (this.m_payload.m_is_cancelled)
		window.close();
	else
	{
		this.m_sfo = new SyncFsmObserver(this.m_payload.m_es);

		window.setTimeout(this.onTimerFire, 0, this);
	}

	this.m_logger.debug("onLoad: exits");
}

SyncWindow.prototype.onAccept = function()
{
	this.m_logger.debug("onAccept: enters");

	if (!this.m_payload.m_is_cancelled)
		Maestro.notifyFunctorUnregister(Maestro.ID_FUNCTOR_SYNCWINDOW);

	this.m_logger.debug("onAccept: exits");

	return true;
}

SyncWindow.prototype.onCancel = function()
{
	this.m_logger.debug("onCancel: enters");
			
	// this fires an evCancel event into the fsm, which subsequently transitions into the 'final' state.
	// The observer is then notified and closes the window.
	//
	if (this.m_syncfsm)
		this.m_syncfsm.cancel(this.m_timeoutID);

	// don't reference logger because logger.js is out of scope after the fsm has cancelled...
	// this.m_logger.debug("onCancel: exits");

	return false;
}

SyncWindow.prototype.onFsmStateChangeFunctor = function(fsmstate)
{
	this.m_logger.debug("functor: entering: fsmstate: " + (fsmstate ? fsmstate.toString() : "null"));

	var functor = {
		m_showlogo: false,

		run: function(win) {
			win.document.getElementById('zindus-statuspanel-logo').setAttribute('hidden', !this.m_showlogo);
			win.document.getElementById('zindus-statuspanel-logo-processing').setAttribute('hidden', this.m_showlogo);
		}
	};

	// Strictly speaking, fsmstate should be null on first call to observer because the 'sync now' button is disabled when the fsm
	// is running.  But there is a race condition because the timer can fire and start in between 'sync now' and here.
	// especially because the addressbooks gets iterated through in the SyncFsmState constructor (which takes a bunch of time).
	// Fixing the race condition would require reworking the notification mechanism via the fsm+maestro
	// So here, if the timer got in first, we just abort the 'Sync Now'.
	// Do we want to create a specific error condition for this?  Perhaps it'd be better to fix the condition
	// eg by altering the notification framework so that PrefsDialog can forestall the Timer immediately (while processing the click).
	//
	if (!this.m_has_observer_been_called && (fsmstate != null || this.m_payload.m_is_cancelled))
	{
		// if fsmstate != null              it means that the timer snuck in between 'Sync Now' and this window
		// if this.m_payload.m_is_cancelled it means that the preferences window was cancelled in between 'Sync Now' and this window
		//
		this.m_logger.debug("onFsmStateChangeFunctor: aborting - closing the window - fsm not started: " +
		                      " fsmstate: " + (fsmstate ? "set" : "not set") + " payload.m_is_cancelled: " + this.m_payload.m_is_cancelled);

		dId('zindus-sw').acceptDialog();
	}
	else if (!this.m_has_observer_been_called)
	{
		// zinAssert(fsmstate == null);

		this.m_has_observer_been_called = true;

		this.m_zwc.populate();

		newLogger().info("sync start:  " + getFriendlyTimeString() + " version: " + APP_VERSION_NUMBER);

		this.m_syncfsm = SyncWindow.newSyncFsm(this.m_payload.m_syncfsm_details);

		this.m_logger.debug("functor: starting fsm: " + this.m_syncfsm.state.id_fsm);

		this.m_syncfsm.start(window);
	}
	else 
	{
		this.m_timeoutID = fsmstate.timeoutID;

		var is_window_update_required = this.m_sfo.update(fsmstate);

		if (is_window_update_required)
		{
			dId('zindus-sw-progress-meter').setAttribute('value',
			                                        this.m_sfo.get(SyncFsmObserver.PERCENTAGE_COMPLETE) );

			var elDescription = dId('zindus-sw-progress-description');
			var elHtml        = document.createElementNS(Xpath.NS_XHTML, "p");

			elHtml.innerHTML = stringBundleString("zfomPrefix") + " " + this.m_sfo.progressToString();

			if (!elDescription.hasChildNodes())
				elDescription.appendChild(elHtml);
			else
				elDescription.replaceChild(elHtml, elDescription.firstChild);

			this.m_logger.debug("ui: " + elHtml.innerHTML);

			functor.m_showlogo = false;
			this.m_zwc.forEach(functor);
		}

		if (fsmstate.isFinal())
		{
			functor.m_showlogo = true;
			this.m_zwc.forEach(functor);

			if (isPropertyPresent(Maestro.FSM_GROUP_TWOWAY, fsmstate.context.state.id_fsm))
			{
				StatusPanel.save(this.m_payload.m_es);
				StatusPanel.update();
			}

			newLogger().info("sync finish: " + getFriendlyTimeString());

			dId('zindus-sw').acceptDialog();
		}
	}
}

SyncWindow.newSyncFsm = function(syncfsm_details)
{
	var id_fsm  = null;
	var account = syncfsm_details.account;
	var type    = syncfsm_details.type;
	var format  = getBimapFormat('long').lookup(null, account.get('format'));
	var syncfsm;

	zinAssert(syncfsm_details.account); // this only supports authonly - TODO: Sync Now

	if      (format == FORMAT_ZM && type == "twoway")    { syncfsm = new SyncFsmZm(); id_fsm = Maestro.FSM_ID_ZM_TWOWAY;   }
	else if (format == FORMAT_GD && type == "twoway")    { syncfsm = new SyncFsmGd(); id_fsm = Maestro.FSM_ID_GD_TWOWAY;   }
	else if (format == FORMAT_ZM && type == "authonly")  { syncfsm = new SyncFsmZm(); id_fsm = Maestro.FSM_ID_ZM_AUTHONLY; }
	else if (format == FORMAT_GD && type == "authonly")  { syncfsm = new SyncFsmGd(); id_fsm = Maestro.FSM_ID_GD_AUTHONLY; }
	else zinAssertAndLog(false, "mismatched case: format: " + format + " type: " + type);

	var prefset_server = new PrefSet(PrefSet.ACCOUNT,  PrefSet.ACCOUNT_PROPERTIES);
	prefset_server.setProperty(PrefSet.ACCOUNT_URL,      account.get('url'));
	prefset_server.setProperty(PrefSet.ACCOUNT_USERNAME, account.get('username'));

	syncfsm.initialise(id_fsm, account.get('sourceid'), syncfsm_details.prefset_general, prefset_server, account.get('password'));

	return syncfsm;
}

// this stuff used to be called from onLoad, but wierd things happen on Linux when the cancel button is pressed
// In using window.setTimeout() this way, the window is guaranteed to be fully loaded before the fsm is started.
//
SyncWindow.prototype.onTimerFire = function(context)
{
	context.m_logger.debug("onTimerFire: enters");

	if (context.m_payload.m_is_cancelled)
	{
		context.m_logger.debug("onTimerFire: payload.m_is_cancelled: " + context.m_payload.m_is_cancelled + " ... closing window");
		window.close();
	}
	else
	{
		context.m_logger.debug("onTimerFire: registering functor");
		var listen_to = cloneObject(Maestro.FSM_GROUP_SYNC);
		Maestro.notifyFunctorRegister(context, context.onFsmStateChangeFunctor, Maestro.ID_FUNCTOR_SYNCWINDOW, listen_to);
	}

	context.m_logger.debug("onTimerFire: exits");
}
