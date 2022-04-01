import isMobile from "is-mobile";

import { InjectedSenderWallet } from "./injected-sender-wallet";
import {
  Action,
  FunctionCallAction,
  State,
  WalletOptions,
  InjectedWallet,
  WalletModule,
} from "@near-wallet-selector/wallet";
import { waitFor } from "@near-wallet-selector/utils";

declare global {
  interface Window {
    near: InjectedSenderWallet | undefined;
  }
}

export interface SenderWalletParams {
  iconPath?: string;
}

export function setupSenderWallet({
  iconPath,
}: SenderWalletParams = {}): WalletModule<InjectedWallet> {
  return function SenderWallet({
    options,
    network,
    emitter,
    logger,
    updateState,
  }: WalletOptions) {
    let wallet: InjectedSenderWallet;

    const getAccounts = () => {
      const accountId = wallet.getAccountId();

      if (!accountId) {
        return [];
      }

      return [{ accountId }];
    };

    const isInstalled = async () => {
      try {
        return await waitFor(() => !!window.near?.isSender, {});
      } catch (e) {
        logger.log("SenderWallet:isInstalled:error", e);

        return false;
      }
    };

    const isValidActions = (
      actions: Array<Action>
    ): actions is Array<FunctionCallAction> => {
      return actions.every((x) => x.type === "FunctionCall");
    };

    const transformActions = (actions: Array<Action>) => {
      const validActions = isValidActions(actions);

      if (!validActions) {
        throw new Error(
          "Only 'FunctionCall' actions types are supported by Sender Wallet"
        );
      }

      return actions.map((x) => x.params);
    };

    return {
      id: "sender-wallet",
      type: "injected",
      name: "Sender Wallet",
      description: null,
      iconUrl: iconPath || "./assets/sender-wallet-icon.png",
      downloadUrl:
        "https://chrome.google.com/webstore/detail/sender-wallet/epapihdplajcdnnkdeiahlgigofloibg",

      isAvailable() {
        if (!isInstalled()) {
          return false;
        }

        if (isMobile()) {
          return false;
        }

        return true;
      },

      async init() {
        if (!(await isInstalled())) {
          throw new Error("Wallet not installed");
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        wallet = window.near!;

        wallet.on("accountChanged", async (newAccountId) => {
          logger.log("SenderWallet:onAccountChange", newAccountId);

          try {
            await this.signOut();
            await this.signIn();
          } catch (e) {
            logger.log(
              `Failed to change account ${(e as unknown as Error).message}`
            );
          }
        });

        wallet.on("rpcChanged", (response) => {
          if (network.networkId !== response.rpc.networkId) {
            updateState((prevState: State) => ({
              ...prevState,
              showModal: true,
              showWalletOptions: false,
              showSwitchNetwork: true,
            }));
          }
        });
      },

      async signIn() {
        if (!(await isInstalled())) {
          return updateState((prevState: State) => ({
            ...prevState,
            showWalletOptions: false,
            showWalletNotInstalled: this.id,
          }));
        }

        if (!wallet) {
          await this.init();
        }

        const { accessKey } = await wallet.requestSignIn({
          contractId: options.contractId,
          methodNames: options.methodNames,
        });

        if (!accessKey) {
          throw new Error("Failed to sign in");
        }

        updateState((prevState: State) => ({
          ...prevState,
          showModal: false,
          selectedWalletId: this.id,
        }));

        const accounts = getAccounts();
        emitter.emit("signIn", { accounts });
        emitter.emit("accountsChanged", { accounts });
      },

      async isSignedIn() {
        return wallet.isSignedIn();
      },

      async signOut() {
        const res = wallet.signOut();

        if (!res) {
          throw new Error("Failed to sign out");
        }

        updateState((prevState: State) => ({
          ...prevState,
          selectedWalletId: null,
        }));

        const accounts = getAccounts();
        emitter.emit("accountsChanged", { accounts });
        emitter.emit("signOut", { accounts });
      },

      async getAccounts() {
        return getAccounts();
      },

      async signAndSendTransaction({
        signerId,
        receiverId,
        actions,
      }: {
        signerId: string;
        receiverId: string;
        actions: Array<Action>;
      }) {
        logger.log("SenderWallet:signAndSendTransaction", {
          signerId,
          receiverId,
          actions,
        });

        return wallet
          .signAndSendTransaction({
            receiverId,
            actions: transformActions(actions),
          })
          .then((res) => {
            if (res.error) {
              throw new Error(res.error);
            }

            // Shouldn't happen but avoids inconsistent responses.
            if (!res.response?.length) {
              throw new Error("Invalid response");
            }

            return res.response[0];
          });
      },
    };
  };
}