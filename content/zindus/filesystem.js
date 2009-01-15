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

var Filesystem = {
	m_a_directory        : new Object(),
	m_a_parent_directory : null,
	eDirectory : new ZinEnum( {
		PROFILE : 'profile',   // C:\Documents and Settings\user\Application Data\Thunderbird\Profiles\blah
		APP     : APP_NAME,    //                                                                      blah\zindus
		LOG     : 'log',       //                                                                      blah\zindus\log
		DATA    : 'data'       //                                                                      blah\zindus\data
	}),
	eFilename : new ZinEnum( {
		LOGFILE  : 'logfile.txt',
		LASTSYNC : 'lastsync.txt',
		GID      : 'gid.txt',
		STATUS   : 'status.txt'
	}),
	ePerm : new ZinEnum( {     // from prio.h
		PR_IRUSR  : 0400,      // Read    by owner
		PR_IWUSR  : 0200,      // Write   by owner
		PR_IXUSR  : 0100,      // Execute by owner
		PR_IRWXU  : 0700       // R/W/X by owner
	}),
	eFlag : new ZinEnum( {     // from prio.h
		PR_RDONLY      : 0x01, // seems silly that mozilla doesn't expose these constants via an interface!
		PR_WRONLY      : 0x02,
		PR_CREATE_FILE : 0x08,
		PR_APPEND      : 0x10,
		PR_TRUNCATE    : 0x20,
		PR_SYNC        : 0x40
	}),
	nsIFileForDirectory : function(name) {
		zinAssertAndLog(this.eDirectory.isPresent(name), name);

		if (!this.m_a_parent_directory)
			with(Filesystem.eDirectory)
				this.m_a_parent_directory = newObject(APP,  PROFILE,
				                                      LOG,  APP,
													  DATA, APP);

		if (!(name in this.m_a_directory))
			if (name == this.eDirectory.PROFILE) {
				// http://developer.mozilla.org/en/docs/Code_snippets:File_I/O
				this.m_a_directory[name] = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties)
				                                  .get("ProfD", Ci.nsIFile);
				this.m_a_directory[name].clone();
			}
			else
			{
				this.m_a_directory[name] = this.nsIFileForDirectory(this.m_a_parent_directory[name]);
				this.m_a_directory[name].append(name);
			}

		return this.m_a_directory[name].clone();
	},
	createDirectoryIfRequired : function(name) {
		var nsifile = this.nsIFileForDirectory(name);

		if (!nsifile.exists() || !nsifile.isDirectory()) 
			try {
				nsifile.create(Ci.nsIFile.DIRECTORY_TYPE, this.ePerm.PR_IRWXU);
			}
			catch (e) {
				let msg = stringBundleString("text.filesystem.create.directory.failed", [ nsifile.path, e ] );
				zinAlert('text.alert.title', msg);
			}
	},
	createDirectoriesIfRequired : function() {
		for (var name in newObjectWithKeys(this.eDirectory.APP, this.eDirectory.LOG, this.eDirectory.DATA))
			this.createDirectoryIfRequired(name)
	},
	writeToFile : function(file, content) {
		var ret = false;

		try {
			if (!file.exists()) 
				file.create(Ci.nsIFile.NORMAL_FILE_TYPE, this.ePerm.PR_IRUSR | this.ePerm.PR_IWUSR);

			let os = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);

			os.init(file, this.eFlag.PR_WRONLY | this.eFlag.PR_TRUNCATE, this.ePerm.PR_IRUSR | this.ePerm.PR_IWUSR, null);
			os.write(content, content.length);
			os.flush();
			os.close();

			ret = true;
		}
		catch (e) {
			zinAlert('text.alert.title', e);
		}

		return ret;
	},
	fileReadByLine : function(path, functor) {
		var file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);

		file.initWithPath(path);

		if (file.exists()) {
			let istream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);

			istream.init(file, this.eFlag.PR_RDONLY,  this.ePerm.PR_IRUSR, 0);
			istream.QueryInterface(Ci.nsILineInputStream);

			let line = {};

			while (istream.readLine(line)) {
				functor.run(line.value); 
				line.value = null;
			} 

			zinAssert(!line.value); // just to confirm that this loop works as documented

			istream.close();
		} 
	}
};
