(ns clj-kondo.clj-commons.slingshot
  (:require [clj-kondo.hooks-api :as api]
            [clojure.walk]))

(defn expand-catch [catch-node]
  (let [[catch catchee & exprs] (:children catch-node)
        catchee-sexpr (api/sexpr catchee)]
    (cond (vector? catchee-sexpr)
          (let [[selector & exprs] exprs]
            (api/list-node
             [catch (api/token-node 'Exception) (api/token-node '_e#)
              (api/list-node
               (list* (api/token-node 'let)
                      (api/vector-node [selector (api/token-node nil)])
                      exprs))]))
          (seq? catchee-sexpr)
          (let [[v & exprs] exprs]
            (api/list-node
             (list* catch (api/token-node 'Exception) v
                    (if (or (= 'fn (first catchee-sexpr))
                            (= 'fn* (first catchee-sexpr)))
                      catchee
                      (api/list-node
                       (list (api/token-node 'fn)
                             (api/vector-node [(api/token-node '%)])
                             catchee)))
                    exprs)))
          :else catch-node)))

(defn try+ [{:keys [node]}]
  (let [children (rest (:children node))
        [body catches]
        (loop [body children
               body-exprs []
               catches []]
          (if (seq body)
            (let [f (first body)
                  f-sexpr (api/sexpr f)]
              (if (and (seq? f-sexpr) (= 'catch (first f-sexpr)))
                (recur (rest body)
                       body-exprs
                       (conj catches (expand-catch f)))
                (recur (rest body)
                       (conj body-exprs f)
                       catches)))
            [body-exprs catches]))
        new-node (api/list-node
                  [(api/token-node 'let)
                   (api/vector-node
                    [(api/token-node '&throw-context) (api/token-node nil)])
                   (api/token-node '&throw-context) ;; use throw-context to avoid warning
                   (with-meta (api/list-node
                               (list* (api/token-node (if (seq catches) 'try 'do))
                                      (concat body catches)))
                     (meta node))])]
    {:node new-node}))

(defn- contains-%?
  "Returns true if % appears within coll at any nesting depth"
  [coll]
  (let [result (atom false)]
    (clojure.walk/postwalk
     (fn [t]
       (when (= '% t)
         (reset! result true)))
     coll)
    @result))

(defn throw+ [{:keys [node]}]
  (if-let [children (seq (rest (:children node)))]
    (if (contains-%? (map api/sexpr children))
      (let [new-node (api/list-node
                      [(api/token-node 'throw)
                       (api/list-node
                        [(api/token-node 'new)
                         (api/token-node 'Exception)
                         (api/list-node
                          [(api/token-node 'str)
                           (api/list-node
                            [(api/token-node 'fn)
                             (api/vector-node [(api/token-node '%)])
                             (api/list-node
                              (list* (api/token-node 'str)
                                     children))])])])])]
        {:node new-node})
      {:node node})
    {:node node}))
