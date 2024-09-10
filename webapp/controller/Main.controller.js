sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/Sorter",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/FilterType",
    "sap/ui/model/json/JSONModel",
    "ui5/ztrip/model/models",
    "sap/m/BusyDialog"
],
function(Controller, Fragment, MessageBox, MessageToast, Sorter, Filter, FilterOperator, FilterType, JSONModel, models, Busydialog) {
    "use strict";

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }
    return Controller.extend("ui5.ztrip.controller.Main", {
        /* Called when the controller is instantiated.
            */
        onInit: function() {
            this.busyDialog = new Busydialog();
        },
         /* called when add icon is pressed in people table
         */
        onAddrow: function() {
            var oView = this.getView();
            if (!this._oApproveDialog) {
                this._oApproveDialog = Fragment.load({
                    id: oView.getId(),
                    name: "ui5.ztrip.Fragments.AddUser",
                    controller: this
                }).then(function(oDialog) {
                    this.getView().addDependent(oDialog);
                    return oDialog;
                }.bind(this));
            }

            this._oApproveDialog.then(function(oDialog) {
                oDialog.open();
                oDialog.setModel(models.initializeUserModel());
            });
        },
        /* called when the ok button is pressed in add user dialog*/
        onOkPress: function() {

            this._oApproveDialog.then(function(oDialog) {
                var oList = this.getView().byId("idUserTable");
                var oBinding = oList.getBinding("items");
                var oDialogData = oDialog.getModel().getData();
                let useName = oDialogData.UserName;
                var sPath = oBinding.getPath() + "('" + useName + "')";
                //
                let oModel = this.getView().getModel();
 oModel.bindContext(sPath, oBinding, {
                        $$groupId: "batchGetEntity"
                    }).requestObject().then(function(oData) {
                        if (oData) {
                            MessageBox.error("User already exists");
                            return;
                        }
                    }).catch(function(oError) {
                        this.setBusy(false);
                        var oContext = oBinding.create(oDialogData);
                        this.onSave();
                        oDialog.close();
                    }.bind(this));
                //
            }.bind(this));
            this.submitBatch("batchGetEntity");
        },
         /* called to save  user.
         */
        onSave: function() {
            var oView = this.getView();
            var fnSuccess = function() {
                    this.setBusy(false);
                    MessageToast.show(this._getText("changesSentMessage"));
                }.bind(this),
                fnError = function(oError) {
                    this.setBusy(false);
                    MessageBox.error(oError.message);
                }.bind(this);
            this.setBusy(true);
            this.getView().getModel().submitBatch("peopleGroup").then(fnSuccess, fnError);
        },
         /* Called when the cancel button is pressed.
         */
        onCancelPress: function() {
            this._oApproveDialog.then(function(oDialog) {
                oDialog.close();
            });
        },
         /* on selection change event handler.
         * 
         * @param {object} oEvent - The event object.
         */
        onSelectionChange: function(oEvent) {
            this.showDetailArea(oEvent.getParameter("listItem").getBindingContext());
        },
         /* Shows the detail area for the selected user.
         * 
         * @param {object} oUserContext - The context of the selected user.
         */
        showDetailArea: function(oUserContext) {
            var oDetailArea = this.byId("detailArea"),
                oLayout = this.byId("idListLayout");
            // oSearchField = this.byId("searchField");
            var sPath = oUserContext.getPath();
            var oModel = new JSONModel([]);
            this.getView().byId("TripsTable").setModel(oModel, "TripsModel");
            oDetailArea.bindElement({
                path: sPath,
                parameters: {
                    $expand: "Trips,Friends"
                },
                events: {
                    dataRequested: this.onDetailsRequested.bind(this),
                    dataReceived: this.onDetailsRecievd.bind(this)
                }
            });
            // oDetailArea.setBindingContext(oUserContext || null);
            oDetailArea.setVisible(!!oUserContext);
            oLayout.setSize(oUserContext ? "60%" : "100%");
            oLayout.setResizable(!!oUserContext);
            // oSearchField.setWidth(oUserContext ? "40%" : "20%");
        },
         /* called when details are recieved.
         */
        onDetailsRecievd: function(oData) {
            this.fetchInvolvedPeople();
        },
         /* used to fetch involed people array by calling the batch function import.
         */
        fetchInvolvedPeople: function() {
            let oDetailArea = this.byId("detailArea");
            let oContext = oDetailArea.getBindingContext();
            if (!oContext.getObject()) {
                return;
            }
            let aTrips = oContext.getObject().Trips;
            let oModel = this.getView().getModel();
            let sPath = oContext.getPath();
            let aInvolvedPeople = [];
            let aPromises = aTrips.map(function(oTrip, i) {
                // @ts-ignore
                return new Promise(function(resolve, reject) {
                    var sPathNwe = sPath + "/" + "Trips(" + oTrip.TripId + ")" + "/" + "GetInvolvedPeople";
                    oModel.bindContext(sPathNwe, oContext, {
                        $$groupId: "batchFunctionImport"
                    }).requestObject().then(function(oData) {
                        for (let p = 0; p < oData.value.length; p++) {
                            oData.value[p].TripId = oTrip.TripId;
                        }
                        aInvolvedPeople = aInvolvedPeople.concat(oData.value);
                        resolve(oData, oTrip);
                    }).catch(function(oError) {
                        this.setBusy(false);
                    });
                });
            });
            this.submitBatch("batchFunctionImport");
            // @ts-ignore
            Promise.all(aPromises).then(function(aResults, oTrip) {
                this.setBusy(false);
                this.filterNonFriends(aInvolvedPeople);
                this.getView().byId("idUserDetTable").getBinding("items").refresh();
            }.bind(this)).catch(function(oError) {
                this.setBusy(false);
            });
        },
         /* filter the array with no friends
         * 
         * @param {Array} aInvolvedPeople - involved peope array
         */
        filterNonFriends: function(aInvolvedPeople) {
            var oDetailArea = this.byId("detailArea");
            var oContext = oDetailArea.getBindingContext();
            var aFriends = oContext.getObject().Friends;
            var aTrips = oContext.getObject().Trips;
            var aNonFriends = [];
            aNonFriends = this.findUniqueUsers(aFriends, aInvolvedPeople);
            let aFinalTrips = [];
            aFinalTrips = this.findMatchedTrips(aNonFriends, aTrips);
            this.getView().byId("TripsTable").getModel("TripsModel").setData(aFinalTrips);
            this.getView().byId("TripsTable").getModel("TripsModel").refresh();
        },
         /* used to call submitBatch method on the model.
         * 
         * @param {Array} sGroupId - The group id to submit the batch request.
         */
        submitBatch: function(sGroupId) {
            var oView = this.getView();
            this.setBusy(true);
            return oView.getModel().submitBatch(sGroupId).finally(function() {
                this.setBusy(false);
            }.bind(this));
        },

        /* Finds unique users in array2 that are not present in array1.
         * 
         * @param {Array} array1 - The first array of users to compare against.
         * @param {Array} array2 - The second array of users to find unique users from.
         * @returns {Array} - Array of users from array2 that are not present in array1.
         */
        findUniqueUsers: function(array1, array2) {
            // Use the filter method to iterate over array2
            return array2.filter(function(user2) {
                // Check if each user2 is not present in array1
                return !array1.some(function(user1) {
                    // Assuming userId is a unique identifier
                    return user1.UserName === user2.UserName;
                });
            });
        },
        /* Finds matched trips in array2 that are present in array1.
         * 
         * @param {Array} array1 - The first array of trips to compare against.
         * @param {Array} array2 - The second array of trips to find matched trips from.
         * @returns {Array} - Array of trips from array2 that are present in array1.
         */
        findMatchedTrips: function(array1, array2) {
            // Use the filter method to iterate over array2
            return array2.filter(function(user2) {
                return array1.some(function(user1) {
                    return user1.TripId === user2.TripId;
                });
            });
        },
        /* called when detail area is requested.
         * 
         * @returns {Void} 
         */
        onDetailsRequested: function() {
            this.setBusy(true);
        },
        /* called to open the busy dialog.
         * 
         * @param {boolean} bBusy - true to open the dialog, false to close it.
            * @returns {Void}
         */
        setBusy: function(bBusy) {
            if (bBusy) {
                this.busyDialog.open();
            } else {
                this.busyDialog.close();
            }
            // this.getView().setBusy(bBusy);
        },
        
        /* Event handler for liveChange with debounce applied
         */
        onLiveChange: debounce(function(oEvent) {
            // Process the input here
            const sValue = oEvent.getParameter("value");
            // eslint-disable-next-line no-console
            console.log("Processing input:", sValue);
            var regExp = /^[a-zA-Z.]*$/;
            
            if (!regExp.test(sValue)) {
            oEvent.getSource().setValueState("Error");
            } else {
                oEvent.getSource().setValueState("None");
            }
        }, 500).bind(this),
        onSearch : function () {
			let oView = this.getView(),
				sValue = oView.byId("searchField").getValue(),
				oFilterLastName = new Filter("LastName", FilterOperator.Contains, sValue),
                oFilterFirstName = new Filter("FirstName", FilterOperator.Contains, sValue),
                 oCombinedFilter = new sap.ui.model.Filter({
                    filters: [oFilterFirstName, oFilterLastName],
                    and: false 
                });
			oView.byId("idUserTable").getBinding("items").filter(oCombinedFilter, FilterType.Application);
		},

/**
		 * Convenience method for retrieving a translatable text.
		 * @param {string} sTextId - the ID of the text to be retrieved.
		 * @returns {string} the text belonging to the given ID.
		 */
_getText : function (sTextId) {
    return this.getOwnerComponent().getModel("i18n").getResourceBundle()
        .getText(sTextId);
}
    });
});